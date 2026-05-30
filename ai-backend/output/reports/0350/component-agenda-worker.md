## Agenda Worker

### Responsibilities

- **Job Consumption**: Poll the MongoDB-backed Agenda.js queue for due jobs—primarily `publish-post` and `prepare-media`—and acquire distributed locks to prevent concurrent execution across worker replicas.
- **Pre-Publish Orchestration**: Validate job payload integrity (`postId`, `userId`, `mediaIds`, `targetPlatforms`); verify that media processing is complete by querying `media_service`; assemble the final publish payload.
- **Dispatch**: Invoke `publisher_service` with per-platform parameters (caption, hashtags, media URLs, target platform account identifiers) to execute the actual social media API calls.
- **Lifecycle Management**: Transition job documents through states (`pending` → `processing` → `completed` / `failed`); append runtime metadata including `durationMs`, `attemptCount`, and `errorMessage`.
- **Rate & Concurrency Guardrails**: Enforce per-user and per-platform concurrency limits to avoid triggering external platform rate limits or overwhelming downstream services.
- **Observability & Cleanup**: Emit structured logs/metrics for job start, success, and failure; archive or TTL-expire stale job records to prevent unbounded growth of the Agenda collection.

### APIs / Interfaces

- **Agenda.js Processor Contract**  
  Registers named job processors via `agenda.define(name, options, handler)`. Key job types:
  - `publish-post`: Executes the full publish pipeline.
  - `prepare-media`: Triggers final media assembly before scheduling the publish job.
  - Job data payload: `{ postId: string, userId: string, scheduleId: string, mediaIds: string[], targetPlatforms: string[], caption?: string, hashtags?: string[] }`.

- **Media Service Client**  
  Internal HTTP/gRPC calls to `media_service`:
  - `GET /internal/media/:mediaId/status` — confirms transcoding/processing completion.
  - `GET /internal/media/:mediaId/urls` — retrieves CDN-ready asset URLs and metadata (dimensions, format).

- **Publisher Service Client**  
  Internal HTTP/gRPC call to `publisher_service`:
  - `POST /internal/publish` — request body includes `userId`, `postId`, `platform`, `mediaUrls[]`, `caption`, `hashtags`, and `scheduledAt`. Returns per-platform `publishId` or error details.

- **MongoDB Interface**  
  Direct connection via Agenda.js driver to the configured database (e.g., `social_automation`) and collection (e.g., `agendaJobs`). Used for job locking, atomic status updates, and retry scheduling.

- **Health & Metrics Endpoint**  
  If wrapped in a lightweight Express shell, exposes:
  - `GET /health` — liveness/readiness for Kubernetes orchestrators.
  - `GET /metrics` — Prometheus-compatible metrics (jobs processed, failures, retry counts, downstream latency).

### Data Owned

The Agenda Worker is stateless; it does not own core domain entities. It manages transient execution artifacts:

- **Job Documents** (Agenda-managed MongoDB collection): `name`, `data`, `priority`, `nextRunAt`, `lastRunAt`, `lockedAt`, `lastModifiedBy`, `failCount`, `failReason`, `repeatInterval`, `repeatTimezone`.
- **Distributed Lock State**: Ephemeral `lockedAt` timestamps and `lastModifiedBy` identifiers (e.g., pod hostname + UUID) indicating which worker instance owns an in-flight job.
- **Execution Traces**: Runtime metadata appended to job documents or a companion `job_logs` collection—start time, end time, downstream service latencies, and platform-specific result payloads.

### Failure Modes

- **Publisher Service Unavailable (5xx / Timeout)**  
  Job fails after configured retry exhaustion. Must mark the post status as `failed` in the domain collection (via callback or event) and surface the failure to the `scheduler_service` or user notification pipeline.

- **External Platform Rate Limit (429)**  
  `publisher_service` returns rate-limit errors. The worker should catch these, increment `failCount`, schedule exponential backoff retry via Agenda’s `job.save()`, and temporarily throttle subsequent jobs targeting the same platform/account.

- **Media Not Ready (404 / Processing)**  
  `media_service` reports incomplete processing. The worker should **not** fail permanently; instead, it should release the lock and schedule a near-term retry (e.g., +2 minutes) up to a maximum media-wait threshold.

- **OAuth Token Expired / Revoked (401 / 403)**  
  Treated as a non-retryable business failure. The job is marked `failed` permanently, the associated platform connection is flagged as invalid, and the `user_service` is notified to prompt re-authentication.

- **Partial Multi-Platform Failure**  
  A single job may target multiple platforms. If Instagram succeeds but LinkedIn fails, the job document must record per-platform outcomes (`platformResults: { instagram: { status: 'success', publishId: '...' }, linkedin: { status: 'failed', error: '...' } }`) so that retry logic re-attempts only the failed subset.

- **Poison Message / Malformed Payload**  
  Repeated processor crashes due to invalid `data` (e.g., missing `mediaIds`). After the configured `maxRetries`, the job must be moved to a dead-letter state or collection and removed from the active queue.

- **MongoDB Connection Loss**  
  Agenda.js cannot acquire locks or update job statuses. The worker process should exit with a non-zero code, allowing the orchestrator to restart it. In-flight jobs will be reclaimed by other replicas after `lockLifetime` expires.

- **Stale Distributed Locks**  
  If a worker crashes mid-job, locks persist until Agenda’s `lockLifetime` (default 10 minutes) expires. During this window, the job is unavailable for reprocessing, causing scheduled publish delays.

### Scaling Considerations

- **Horizontal Replication**  
  Workers are fully stateless and can be scaled horizontally behind a Kubernetes Deployment or similar. Multiple instances safely share the same MongoDB job collection because Agenda’s distributed locking (`lockedAt` + `lastModifiedBy`) prevents duplicate execution.

- **Concurrency Tuning**  
  - Global limit: `agenda.concurrency(20)` to cap total in-flight jobs per instance.
  - Per-job limits: Lower concurrency for video-heavy `publish-post` jobs (e.g., `concurrency: 5`) versus lightweight text-only jobs to balance memory and I/O.

- **Queue Segregation**  
  Deploy separate worker pools (or Agenda namespaces) for distinct workloads:
  - **High-priority queue**: Manual/immediate posts.
  - **Standard queue**: Recurring scheduled posts.
  - **Media-prep queue**: CPU-bound pre-processing tasks.
  This prevents a backlog of video transcoding from delaying simple image posts.

- **MongoDB Load & Indexing**  
  High-throughput polling requires compound indexes on:
  - `{ nextRunAt: 1, lockedAt: 1, priority: -1 }` for job fetching.
  - `{ name: 1, lockedAt: 1 }` for processor filtering.
  For massive scale, shard the Agenda collection by `data.userId` or `name` to distribute write load.

- **Circuit Breakers & Backpressure**  
  Integrate circuit breakers on outbound calls to `publisher_service` and `media_service`. If failure rates exceed a threshold, fail fast and let jobs remain queued rather than saturating downstream services with doomed requests.

- **Graceful Shutdown**  
  On `SIGTERM`, stop accepting new jobs (`agenda.stop()`), allow in-flight jobs to complete or timeout, and release locks cleanly. This minimizes stale lock windows during rolling deployments.

- **Resource Allocation**  
  Run workers on compute-optimized nodes separate from the public API tier. Video publishing jobs may require higher memory limits; use node affinity or separate deployments to isolate resource profiles.

### Related Diagrams

No paired Mermaid diagram was provided for this component.