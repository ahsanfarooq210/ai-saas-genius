## component-circuit-breaker

### Responsibilities

- Maintain distributed circuit state (`CLOSED`, `OPEN`, `HALF_OPEN`) for every external social media platform API endpoint used by the `publisher_service`, scoped both per-platform and per-connected-user account.
- Fail fast on outbound publish requests when a platform is experiencing an infrastructure outage, preventing the `job_worker` and `publisher_service` from wasting CPU, memory, and Redis Streams queue capacity on doomed retries.
- Distinguish platform-level failures (HTTP 5xx, TCP timeouts, DNS failures, HTTP 429 rate-limit blocks) from client-level errors (HTTP 400, 401, 403, 404) so that expired tokens or deleted posts do not trip the breaker.
- Coordinate safe probe traffic during the `HALF_OPEN` recovery phase by serializing a limited number of test requests through a Redis-backed semaphore.
- Emit state-transition events (`OPENED`, `HALF_OPENED`, `CLOSED`) consumed by the platform’s observability stack to drive alerts and dashboards.
- Provide administrative override endpoints so operators can manually force a circuit `OPEN` during scheduled platform maintenance or force it `CLOSED` after a confirmed recovery.

### APIs / Interfaces

The circuit breaker is implemented as a Node.js module instantiated within the `publisher_service` processes. It exposes the following interface:

- `check(platform: string, accountId: string): Promise<CircuitCheckResult>`  
  Reads the current circuit state from Redis. Returns `{ allowed: true, state: 'CLOSED' }` when healthy; returns `{ allowed: false, state: 'OPEN', retryAfter: Date }` when open; and returns `{ allowed: true, state: 'HALF_OPEN', probeSlot: number }` when a probe semaphore was successfully acquired.

- `recordSuccess(platform: string, accountId: string): Promise<void>`  
  Called by `publisher_service` after a platform API returns HTTP 2xx. In `HALF_OPEN`, atomically increments a success counter in Redis; if the counter reaches the configured threshold (e.g., 3 consecutive successes), transitions the circuit to `CLOSED` and deletes the failure window.

- `recordFailure(platform: string, accountId: string, meta: FailureMeta): Promise<void>`  
  Called after a platform request fails. Inspects `meta.statusCode` and `meta.errorCode`. Only increments the failure window for 5xx, timeouts, or 429s. If the failure count in the rolling window exceeds the threshold (e.g., 5 failures in 60 seconds), atomically transitions the circuit to `OPEN` and sets a TTL-based lock.

- `forceState(platform: string, accountId: string, state: 'CLOSED' | 'OPEN' | 'HALF_OPEN', ttlSeconds?: number): Promise<void>`  
  Administrative override that writes the desired state directly to Redis, bypassing automatic logic. Used for incident response and post-mortem recovery.

- `getState(platform: string, accountId: string): Promise<CircuitStateSnapshot>`  
  Returns the raw Redis hash for debugging: `state`, `openedAt`, `failureCount`, `lastFailureAt`, `halfOpenProbesRemaining`.

- Event emitter: `circuitBreaker.on('stateChange', (evt) => { ... })`  
  Emits structured events containing `platform`, `accountId`, `previousState`, `newState`, and `timestamp` so that `publisher_service` can log to MongoDB ops or forward to external alerting.

### Data Owned

All runtime state is stored in the `redis_cache` instance; the circuit breaker itself is stateless between Node.js process restarts.

- `circuit:state:{platform}:{accountId}` — Redis Hash  
  Fields: `state` (`CLOSED`/`OPEN`/`HALF_OPEN`), `openedAt` (epoch ms), `lastFailureAt` (epoch ms), `halfOpenProbes` (integer), `version` (incrementing integer for optimistic locking). TTL: 24 hours when `CLOSED`, 5 minutes when `OPEN` (extended on each retry), and 2 minutes when `HALF_OPEN`.

- `circuit:failures:{platform}:{accountId}` — Redis Sorted Set  
  Members are epoch-millisecond timestamps of qualifying infrastructure failures. Score is the timestamp. The sliding window is maintained by trimming entries older than the configured window (e.g., 60 seconds) after each `recordFailure` call via `ZREMRANGEBYSCORE`.

- `circuit:probe:{platform}:{accountId}` — Redis String (semaphore)  
  Used as an atomic lease counter during `HALF_OPEN`. Initialized to the max probe count (e.g., 2). Decremented via `DECR` when a probe request is allowed; incremented via `INCR` when a probe completes (success or failure). If the value drops below 0, no new probes are admitted.

- `circuit:global:{platform}` — Redis Hash  
  Aggregated platform-wide health used for fast-path decisions. Fields: `globalState`, `affectedAccounts` (approximate count via HyperLogLog reference), `lastGlobalFailureAt`. Updated when the percentage of per-account circuits in `OPEN` state for a single platform exceeds a threshold (e.g., 30% of active accounts in 2 minutes), indicating a platform-wide outage rather than isolated account issues.

### Failure Modes

- **Redis unavailability:** If the `redis_cache` connection drops, the breaker cannot read or write state. The module falls back to a small in-memory LRU cache (max 5,000 entries, 30-second TTL). If no local entry exists, it defaults to `CLOSED` (allow traffic) to avoid halting all publishing globally, but logs a critical error and triggers a PagerDuty-style alert.
- **False OPEN from auth errors:** A batch of expired OAuth tokens returning HTTP 401 could be mistaken for a platform outage. The `recordFailure` implementation strictly filters on `meta.statusCode >= 500 || meta.code === 'ETIMEDOUT' || meta.statusCode === 429`. HTTP 401/403 failures are routed to the `auth_service` token refresh flow and do not touch the circuit breaker failure window.
- **Thundering herd during recovery:** When a circuit transitions to `HALF_OPEN`, a backlog of queued Agenda.js jobs could flood the platform. The `circuit:probe:{platform}:{accountId}` semaphore limits in-flight probes to a configurable number (default 1). Additional jobs receive `{ allowed: false, state: 'OPEN' }` until the probe completes.
- **Stale OPEN state after platform recovery:** If no jobs are scheduled for an account while a platform recovers, the circuit may remain `OPEN` indefinitely. A background reconciliation task (running every 60 seconds via `scheduler_service`) scans circuits with `openedAt` older than a maximum age (e.g., 10 minutes) and forces them to `HALF_OPEN` to allow natural recovery probes.
- **Clock skew across Node.js instances:** Sliding window calculations rely on timestamps. All Lua scripts that evaluate failure windows use `redis.call('TIME')` rather than the application server clock, ensuring consistent window boundaries regardless of host drift.
- **Memory exhaustion from key explosion:** With millions of user accounts across five platforms, per-account circuit keys could bloat Redis. Mitigated by: (1) aggressive TTLs on `CLOSED` state hashes so inactive accounts auto-expire, and (2) using Redis Hashes instead of separate keys per metric to reduce keyspace overhead.

### Scaling Considerations

- **Horizontal scalability:** Because all state is externalized to `redis_cache`, any `publisher_service` instance can evaluate a circuit without sticky sessions or local affinity. The module is instantiated as a singleton in each Node.js worker process.
- **Atomic state transitions:** Transitions between states (e.g., `CLOSED` → `OPEN`, `HALF_OPEN` → `CLOSED`) are performed via Redis Lua scripts to prevent race conditions when multiple `publisher_service` instances simultaneously report failures or successes for the same account.
- **Latency budget:** A circuit check must complete in under 5 ms to avoid delaying the publish hot path. The implementation uses Redis `HGETALL` for state reads and pipelines `HGETALL` + `ZCARD` where possible. No MongoDB lookups occur in the check path.
- **Platform-wide circuit aggregation:** At high scale, evaluating millions of per-account circuits for a global outage is expensive. The `circuit:global:{platform}` hash provides a fast-path: if the global circuit is `OPEN`, all publish attempts for that platform fail immediately without per-account Redis lookups.
- **Observability without Redis load:** State transition events are buffered in memory and flushed to the application logger (Winston/Pino) rather than writing audit trails back to Redis. Prometheus counters (`circuit_breaker_state_total`, `circuit_breaker_transitions_total`, `circuit_breaker_probe_results_total`) are maintained locally per process and scraped by the metrics collector.
- **Batch operations:** When the `job_worker` dequeues a batch of jobs for the same platform, the circuit breaker supports a `checkBatch(platform, accountIds[])` helper that uses Redis `MGET` / `HMGET` pipelines to reduce round trips.