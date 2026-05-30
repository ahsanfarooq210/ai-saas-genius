# ADR-002: Job Scheduler Choice — Agenda.js with MongoDB

## Status
Accepted

## Context
The social media automation platform must reliably execute user-defined publishing schedules across multiple external platforms (Twitter/X, Instagram, Facebook, LinkedIn). Users configure posting frequencies, timezone-specific publishing windows, media types, and account-specific preferences. The system must translate these preferences into durable, time-triggered background jobs that survive service restarts, support horizontal scaling of workers, and integrate natively with our Node.js/Express backend and MongoDB primary database.

## Decision
We will use **Agenda.js** as the job scheduling library, with **MongoDB** as the persistent job store.

## Rationale
- **Stack cohesion**: Agenda.js is purpose-built for Node.js and persists jobs directly to MongoDB, avoiding the operational overhead of introducing Redis, RabbitMQ, or a separate database cluster.
- **Durability**: Jobs are stored as documents in MongoDB (`agendaJobs` collection), ensuring schedules survive `scheduler_service` or `agenda_worker` restarts without additional snapshotting mechanisms.
- **Distributed locking**: Agenda.js uses atomic MongoDB updates on `lockedAt` and `lastModifiedBy` fields, allowing multiple stateless `agenda_worker` processes to poll for work without duplicate execution.
- **Recurrence model**: Native support for cron expressions and human-readable intervals (`every`, `schedule`, `now`) maps directly to user-facing posting frequencies (e.g., "daily at 9:00 AM EST").
- **Graceful degradation**: Built-in `stop()` and `disable()` methods allow workers to drain in-flight publishing tasks during deployments, reducing the risk of partial posts to `platform_apis`.

## Implementation Architecture

### Responsibilities
- **scheduler_service**: Computes publishing schedules from user preference documents and mutates the Agenda.js job graph. It handles CRUD operations on recurring jobs but does not execute them.
- **agenda_worker**: Hosts the Agenda instance in worker/processor mode. It registers named job definitions (e.g., `prepare-content`, `publish-post`) and polls MongoDB to execute due jobs.

### APIs / Interfaces

**scheduler_service internal API** (consumed by `user_service` and `content_service`):
- `POST /internal/schedules` — Idempotently create or update a recurring publishing schedule for a user-platform pair.
- `DELETE /internal/schedules/:userId/:platform` — Cancel all future jobs for a specific user-platform combination.
- `GET /internal/schedules/:userId` — Return active job names, next run times, and last execution status.

**Agenda.js programmatic interface** (used by both services):
```javascript
// scheduler_service: schedule creation
await agenda.start();
await agenda.every('0 9 * * 1-5', 'publish-post', { userId, contentId, platform });

// agenda_worker: processor registration
agenda.define('publish-post', { 
  priority: 10, 
  concurrency: 5, 
  lockLifetime: 300000 // 5 minutes
}, async (job) => {
  const { userId, contentId, platform } = job.attrs.data;
  await publisher_service.executePublish(userId, contentId, platform);
});
```

### Data Ownership
- **MongoDB `agendaJobs` collection**: Owned by the Agenda.js library. Each document represents a job instance with fields including `name`, `data` (payload), `type` (`single`, `normal`, `every`), `nextRunAt`, `priority`, `lockedAt`, `lastModifiedBy` (worker identifier), `failCount`, and `failReason`.
- **scheduler_service** owns the business-logic mapping between a user's `posting_preferences` document (stored in `mongodb` by `user_service`) and the corresponding Agenda job name/schedule.
- **agenda_worker** owns the processor function implementations but is stateless with respect to job scheduling; it acts strictly on documents in the `agendaJobs` collection.

## Failure Modes

| Failure Scenario | Impact | Mitigation |
|------------------|--------|------------|
| **MongoDB unavailable** | `scheduler_service` cannot persist new schedules; `agenda_worker` cannot claim or complete jobs. | Return HTTP 503 from scheduler endpoints. Workers retry MongoDB connection with exponential backoff. Implement a health-check circuit breaker before accepting schedule mutations. |
| **Worker crash mid-job** | Job remains in `locked` state; no completion record written. | Agenda.js `lockLifetime` (configured per job type) expires, releasing the job for re-pickup. All job processors must be idempotent—duplicate `publish-post` executions must not create duplicate platform posts. |
| **Long-running media processing inside job** | Worker thread blocked, reducing throughput and delaying other scheduled posts. | Keep Agenda jobs lightweight. `agenda_worker` must delegate media assembly and upload to `media_service` via async API calls and exit the processor as soon as the handoff is confirmed. |
| **Duplicate schedule creation** | Race condition in `scheduler_service` creates overlapping recurring jobs for the same user-platform slot. | Enforce deterministic job naming convention: `publish:{userId}:{platform}:{slotId}`. Use Agenda's upsert semantics (`agenda.every` with a uniquely named job) rather than blind insertion. |
| **Clock skew across worker nodes** | Premature or delayed job execution if system clocks diverge. | Enforce NTP synchronization on all worker nodes. Agenda.js relies on `nextRunAt` compared against local `Date.now()`, so skew directly affects accuracy. |
| **Platform API rate limiting during publish** | Job fails repeatedly, incrementing `failCount` and potentially triggering Agenda's default backoff lockout. | `publisher_service` must return distinct error codes for rate-limit (HTTP 429) vs. permanent failure. `agenda_worker` should catch rate-limit errors and use Agenda's `job.fail` with a custom retry window, or defer to a dead-letter queue after N attempts. |

## Scaling Considerations

- **Horizontal worker scaling**: `agenda_worker` instances are stateless. Adding replicas increases throughput because Agenda.js coordinates via MongoDB document-level locking. No singleton coordinator or leader election is required.
- **Database polling load**: By default, Agenda.js queries MongoDB every 5 seconds (`processEvery`). With 10+ worker replicas, this generates sustained read load on the `agendaJobs` collection.
  - **Mitigation**: Increase `processEvery` to 15–30 seconds if the business requirement allows ±30s publishing drift. Ensure the compound index on `{ nextRunAt: 1, name: 1, priority: -1, lockedAt: 1 }` is present (Agenda creates this automatically).
- **Concurrency tuning**: Set per-job-type concurrency caps to prevent overwhelming external `platform_apis`. For example, `publish-post` concurrency should align with the most restrictive platform's rate limit (e.g., 5 concurrent Twitter publishes).
- **Job collection growth**: Recurring jobs (`type: 'every'`) reuse a single document, but failed jobs with high `failCount` and historical single-run jobs can bloat the collection.
  - **Mitigation**: Configure Agenda's `defaultLockLifetime` and a nightly cleanup task to remove successfully completed jobs older than retention policy (e.g., 30 days).
- **Sharding boundary**: Agenda.js does not natively shard job processing across multiple MongoDB databases by job type. If the `agendaJobs` collection outgrows a single MongoDB replica set, isolate job categories (e.g., `publish-post` vs. `generate-content`) onto separate Agenda instances pointing to distinct MongoDB databases or collections.

## Alternatives Considered

| Alternative | Pros | Cons | Reason Rejected |
|-------------|------|------|-----------------|
| **BullMQ (Redis-backed)** | Very high throughput; built-in rate limiting; robust delayed job semantics | Requires Redis cluster infrastructure; separate persistence model from our MongoDB source of truth; additional operational cost | Introduces infrastructure heterogeneity for a core workflow |
| **node-cron (in-memory)** | Zero dependencies; extremely simple | No persistence across restarts; no distributed locking; impossible to inspect job queue state | Unacceptable for a SaaS publishing platform where missed posts equal broken SLAs |
| **AWS EventBridge** | Serverless; managed cron; no worker process to maintain | Deep vendor lock-in; limited payload size (256 KB); opaque debugging; difficult to cancel or modify recurring schedules atomically | Conflicts with portable, multi-cloud deployment target |
| **RabbitMQ with Delayed Message Plugin** | Reliable queuing; language-agnostic consumers | Requires separate broker deployment; no built-in cron recurrence; delayed message TTL has known performance degradation with large queue depths | Operational complexity exceeds benefit given our existing MongoDB investment |

## Related Diagrams
- `diagrams/0350/iter1_overview.mmd`