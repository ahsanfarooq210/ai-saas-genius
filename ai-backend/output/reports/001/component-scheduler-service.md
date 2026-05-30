# Scheduler Service

## Responsibilities

The Scheduler Service translates user-defined posting preferences into concrete, executable background jobs managed by Agenda.js. It acts as the control plane for the automation platform’s publishing cadence.

- **Preference Translation**: Converts high-level user settings—target platforms, posting frequency, media type, captions, hashtags, publishing times, and account-specific preferences—into Agenda.js job definitions with precise `nextRunAt` timestamps and recurrence rules.
- **Job Lifecycle Management**: Creates, updates, pauses, resumes, and cancels scheduled jobs. Ensures that changes to user preferences are reflected by regenerating or mutating the associated Agenda.js job documents in MongoDB.
- **Content Binding**: Resolves post draft IDs from the Content Service into lightweight job payloads so that the Agenda Worker has all necessary references (media IDs, caption text, platform targets) at execution time without re-querying the Content Service.
- **Temporal Validation**: Validates IANA timezone strings, detects ambiguous local times during DST transitions, and rejects impossible cron expressions or date ranges (e.g., February 30th).
- **Schedule Auditing**: Maintains a record of schedule mutations (who changed what and when) to support debugging missed or duplicate posts.
- **Queue Health Exposure**: Provides the API Gateway with endpoints to inspect upcoming jobs, last-run statuses, and queue backpressure metrics.

## APIs / Interfaces

### Internal REST Endpoints (Exposed via API Gateway)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/schedules` | Creates a new posting schedule and generates the initial Agenda.js job(s). Accepts user preferences payload and returns a `scheduleId`. |
| `GET` | `/schedules/:scheduleId` | Retrieves schedule metadata, recurrence rules, bound draft IDs, and computed next-run timestamps. |
| `PUT` | `/schedules/:scheduleId` | Updates preferences. Atomically cancels orphaned future jobs and regenerates new ones to match the updated rules. |
| `DELETE` | `/schedules/:scheduleId` | Cancels all pending jobs for the schedule and marks the schedule as deleted. |
| `POST` | `/schedules/:scheduleId/pause` | Disables future job execution without removing job documents from Agenda’s collection. |
| `POST` | `/schedules/:scheduleId/resume` | Re-enables a paused schedule, recomputing `nextRunAt` from the current time. |
| `GET` | `/schedules/:scheduleId/jobs` | Returns a paginated list of Agenda.js job documents associated with this schedule, including state (`scheduled`, `completed`, `failed`). |
| `POST` | `/schedules/:scheduleId/trigger` | Manually enqueues an immediate, one-off publishing job tied to the schedule’s current draft and platform settings. |

### Service Integrations

- **Content Service**: Synchronous HTTP/gRPC calls to validate that referenced `contentDraftIds` exist and to retrieve normalized publish payloads (caption, hashtag list, media asset references). The Scheduler Service embeds these references into the Agenda job’s `data` field so the downstream Agenda Worker is decoupled from the Content Service at runtime.
- **Agenda.js (MongoDB-backed queue)**: Uses the Agenda library to persist job definitions directly into the shared MongoDB `agendaJobs` collection. The Scheduler Service calls `agenda.schedule(when, jobName, data)` and `agenda.every(interval, jobName, data)` but does **not** define the job processor functions—those live in the Agenda Worker.
- **MongoDB**: Stores application-level schedule metadata in a dedicated `schedules` collection, separate from Agenda’s internal job collection. Uses MongoDB transactions when updating a schedule document and its associated Agenda jobs to ensure consistency.

## Data Ownership

The Scheduler Service owns the following MongoDB collections and schemas:

- **`schedules`**  
  Canonical record of a user’s posting automation rules.  
  - `scheduleId` (UUID), `userId` (indexed), `status` (`active`, `paused`, `cancelled`)  
  - `rules`: `frequency` (cron string or interval), `timezone` (IANA string), `activeWindow` (`startDate`, `endDate`), `preferredPublishTimes` (array of local time windows)  
  - `targets`: array of platform connection IDs and account-specific overrides  
  - `contentDraftIds`: references to drafts in the Content Service  
  - `nextRunAt`, `lastRunAt`, `createdAt`, `updatedAt`  

- **`scheduleJobMappings`**  
  Traceability join table linking a `scheduleId` to one or more Agenda job `_id`s. Enables fast lookup of all Agenda jobs spawned by a given schedule without scanning Agenda’s collection.  
  - `scheduleId`, `agendaJobId`, `jobType` (`recurring`, `one-off`, `manual`), `createdAt`  

- **`scheduleAuditLogs`**  
  Immutable log of mutations.  
  - `scheduleId`, `action` (`create`, `update`, `pause`, `cancel`), `diff` (BSON patch), `actorUserId`, `timestamp`  

## Failure Modes

- **Agenda Job Insertion Failure**: If the MongoDB write to Agenda’s job collection fails (network partition, primary failover), the post is silently dropped. The service must catch `MongoServerError`, retry with exponential backoff, and emit a failure event to the Notification Service if unrecoverable.
- **Orphaned Jobs on Schedule Update**: When a user modifies their posting frequency, previously scheduled Agenda jobs for the old rules must be located and removed. If the mapping table is out of sync or the deletion transaction aborts, stale jobs may execute. Mitigate by using a MongoDB multi-document transaction across `schedules`, `scheduleJobMappings`, and Agenda’s collection.
- **Timezone/DST Boundary Errors**: A schedule set for “2:30 AM” in `America/New_York` will encounter a gap during spring DST and an overlap during fall DST. The service must reject ambiguous times and normalize all stored timestamps to UTC while preserving the user’s original local-time intent for recurrence calculations.
- **Stale Draft Resolution**: If a user edits a caption after the job is scheduled but before it runs, the Agenda Worker may publish outdated content. The Scheduler Service should store a `contentSnapshotVersion` or instruct the Worker to re-resolve the draft at publish time, depending on the desired consistency model.
- **Duplicate Job Creation**: Retried `POST /schedules` requests due to gateway timeouts can result in double bookings. The `POST /schedules` endpoint must require an `Idempotency-Key` header and enforce uniqueness on `(userId, idempotencyKey)`.
- **Invalid Recurrence Pre-computation**: A cron expression like `0 0 * * 31` (31st of every month) causes Agenda to skip months silently. The service must validate cron feasibility against a calendar matrix before accepting it.
- **Queue Flooding from Bulk Operations**: Bulk onboarding or imports can create thousands of schedules simultaneously, spiking MongoDB write load. The service must implement a creation rate limit (e.g., token bucket per user) and, for bulk admin operations, use Agenda’s bulk insert APIs if available or queue schedule creation itself as a background task.

## Scaling Considerations

- **Stateless Horizontal Scaling**: The Scheduler Service Express instances are stateless and can scale behind a load balancer. Because Agenda.js job creation is a database write, multiple Scheduler instances do not conflict as long as unique indexes (e.g., on `scheduleJobMappings.agendaJobId`) are maintained.
- **MongoDB Write Pressure**: High-volume recurring schedules generate large numbers of job documents. Completed Agenda jobs should be archived or purged via MongoDB TTL indexes to prevent unbounded growth of the working set. The Scheduler Service should avoid querying Agenda’s collection for analytics; instead, rely on the `scheduleJobMappings` and audit logs.
- **Timezone Computation Cost**: Recomputing `nextRunAt` for thousands of recurring schedules at DST transition boundaries is CPU-intensive. Cache parsed timezone offsets and pre-compute upcoming run windows in batches during off-peak hours.
- **Decoupling from Content Service**: If the Content Service experiences latency, the Scheduler Service’s synchronous draft resolution during schedule creation will block. Consider resolving drafts asynchronously: accept `contentDraftIds` immediately, return `scheduleId`, and let a background reconciliation task validate and hydrate the payload before the first job runs.
- **Backpressure Protection**: If the Agenda Worker falls behind (high `lockedAt` count), the Scheduler Service should throttle new schedule creation and surface queue-depth metrics to operators. Implement a circuit breaker that pauses non-urgent schedule generation when Agenda’s pending job count exceeds a configurable threshold.
- **Indexing Strategy**: Ensure Agenda’s MongoDB collection is indexed on `{ nextRunAt: 1, name: 1, lockedAt: 1 }` for efficient job picking. The Scheduler Service’s own `schedules` collection requires indexes on `{ userId: 1, status: 1 }` and `{ nextRunAt: 1 }`.

## Related Diagrams

No paired diagram was specified for this document.