# Runbook: Platform API Limits

## Scope

This document governs the operational controls, monitoring thresholds, and incident response procedures for managing external social media platform API quotas. It applies to all outbound traffic from `Publish_Service` to Instagram Graph API, Twitter/X API v2, Facebook Graph API, LinkedIn API, and TikTok Content Publishing API, and specifies how the platform enforces distributed throttling, circuit breaking, and degraded-mode scheduling to prevent account bans or app-level suspensions.

## Responsibilities

- **Quota Monitoring**: Inspect platform-specific rate-limit headers on every outbound request and persist near-limit states to `Redis_Cache` and `MongoDB`.
- **Distributed Throttling**: Coordinate request gating across horizontally scaled `Publish_Service` instances so that per-user and per-app counters remain accurate under concurrent load.
- **Job Backoff Orchestration**: Translate `429` / quota-exhaustion responses into Agenda.js `backoff` strategies that defer jobs to the next available rate-limit window.
- **Circuit Breaking**: Open platform-specific or user-specific circuits when error rates or quota consumption exceed safe thresholds, preventing retry storms.
- **Alerting & Notification**: Emit PagerDuty alerts when aggregate app usage crosses 80%, and notify end users when their personal daily caps are reached.
- **Triage & Recovery**: Provide step-by-step playbooks for responding to platform blocks, token deauthorizations, and runaway job loops.

## Monitored Limits & Thresholds

The system maintains **hard limits** (`LIMIT`) derived from platform documentation and **internal thresholds** (`THRESHOLD`) at which new jobs are queued rather than executed.

### Instagram Graph API
| Dimension | THRESHOLD | LIMIT | Source / Header |
|---|---|---|---|
| Publishing (Feed/Reels) per user/hour | 180 | ~200 | `x-business-use-case-usage` → `call_count` |
| Business Discovery per user/hour | 180 | ~200 | `x-business-use-case-usage` |
| App-level (Marketing API) | 90% of (200 × MAU) | 100% of (200 × MAU) | `x-app-usage` → `call_count` |

### Twitter/X API v2
| Dimension | THRESHOLD | LIMIT | Source / Header |
|---|---|---|---|
| Tweets per 15-min window (user context) | 180 | 200 | `x-rate-limit-remaining` |
| Media upload chunks per app/15-min | 400 | 500 | `x-rate-limit-remaining` |
| Monthly tweet cap (Basic tier assumption) | 2,700 | 3,000 | Dashboard-enforced; tracked in `platform_api_states` |

### Facebook Graph API
| Dimension | THRESHOLD | LIMIT | Source / Header |
|---|---|---|---|
| Page posts per user-token/hour | 180 | ~200 | `x-app-usage` → `call_count` |
| App-level rolling cpu_time | 80% | 100% | `x-app-usage` → `total_cputime` |

### LinkedIn API
| Dimension | THRESHOLD | LIMIT | Source / Header |
|---|---|---|---|
| UGC Posts per user/day | 80 | ~100 (heuristic) | `x-ratelimit-remaining` |
| App-level calls per day | 450 | 500 | `x-ratelimit-limit` / `x-ratelimit-remaining` |

### TikTok Content Publishing API
| Dimension | THRESHOLD | LIMIT | Source / Header |
|---|---|---|---|
| App-level queries per day | 900 | 1,000 | `X-RateLimit-Limit` |
| Direct posts per creator/hour | 4 | 5 | `X-RateLimit-Remaining` |

## Interfaces & Integration Points

### Internal APIs
- **`GET /internal/platform-limits/status?platform={p}&userId={u}`**
  - Implemented by a lightweight middleware in `Publish_Service`.
  - Returns `{ canProceed: boolean, resetAt: ISO8601, remaining: number }`.
  - `Job_Service` queries this before enqueueing high-volume batches.

- **`POST /internal/platform-limits/record`**
  - Called by `Publish_Service` immediately after every platform API response.
  - Accepts a payload containing HTTP headers, `userId`, `platform`, and `endpoint`.
  - Updates Redis counters and persists header snapshots to MongoDB `publish_attempts`.

### Redis Keyspace
| Key Pattern | Type | Purpose |
|---|---|---|
| `ratelimit:{platform}:user:{userId}:window` | Sorted Set (sliding window) | Tracks per-user call timestamps for the current window. |
| `ratelimit:{platform}:app:tier:{tierId}:bucket` | String (Lua token bucket) | Tracks app-level token bucket state (tokens, last refill). |
| `circuit:{platform}:user:{userId}` | String | Circuit breaker state (`closed`, `open`, `half-open`) with TTL. |
| `circuit:{platform}:app:tier:{tierId}` | String | App-level circuit state when aggregate usage is critical. |

### Agenda.js Integration
- Jobs targeting external platforms are defined with `priority: -10` (standard) or `priority: 10` (retry).
- `backoff` strategy:
  ```json
  {
    "type": "exponential",
    "delay": 60000,
    "maxDelay": 3600000
  }
  ```
- A custom `shouldRetry` hook inspects the prior failure; if it was a quota error with a `Retry-After` header, the hook overrides `nextRunAt` to `Date.now() + (Retry-After * 1000)`.

## Data Owned

### MongoDB Collections

**`platform_api_states`**
```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "platform": "instagram",
  "tier": "basic",
  "appUsagePercent": 72,
  "remainingCalls": 45,
  "windowResetAt": "2024-05-20T14:00:00Z",
  "circuitBreaker": "closed",
  "openedAt": null,
  "lastUpdated": "2024-05-20T13:45:00Z"
}
```

**`publish_attempts` (TTL 48h)**
```json
{
  "jobId": "agendaJobId",
  "userId": "ObjectId",
  "platform": "twitter",
  "endpoint": "POST /2/tweets",
  "statusCode": 429,
  "headers": {
    "x-rate-limit-remaining": "0",
    "x-rate-limit-reset": "1716213600"
  },
  "recordedAt": "ISODate"
}
```

**`platform_tier_configs`**
- Stores baseline `LIMIT` and `THRESHOLD` values per platform tier so that limits can be tuned without code deployment.

## Failure Modes & Mitigation

### 1. HTTP 429 / Rate Limit Exceeded
- **Detection**: `Publish_Service` intercepts `429` or platform-specific error codes (e.g., Facebook error code `4`, Instagram `10`).
- **Response**:
  - Extract `Retry-After` (seconds) or calculate from `x-rate-limit-reset` (epoch).
  - Set Redis `circuit:{platform}:user:{userId}` to `open` with TTL = `Retry-After`.
  - Fail the Agenda.js job with `shouldRetry: true`; the retry scheduler reads the circuit TTL and sets `nextRunAt` accordingly.
  - If `Retry-After` exceeds 1 hour, move the job to a `deferred` queue instead of standard retry.

### 2. App-Level Quota Exhaustion
- **Detection**: A background cron (every 5 min) scans `platform_api_states` where `appUsagePercent >= 90`.
- **Response**:
  - Reduce `Publish_Service` worker concurrency for that platform from `PLATFORM_CONCURRENCY` (default 20) to 2 via in-memory config toggle.
  - Pause non-priority scheduling in `Job_Service` for the affected platform tier.
  - Page on-call engineer via PagerDuty.

### 3. User Daily Hard Cap Reached
- **Detection**: Redis `ratelimit:{platform}:user:{userId}:window` counter reaches 0.
- **Response**:
  - No further attempts for that `(user, platform)` pair until `windowResetAt`.
  - Jobs are rescheduled to `nextRunAt = windowResetAt + random(0, 300)` seconds to avoid a thundering herd at midnight.
  - `Notification_Service` sends a digest email: *"You have reached your daily publishing limit for {platform}."*

### 4. Token Deauthorization or Permission Loss
- **Detection**: `401` / `403` with specific subcodes (e.g., Facebook `190` invalid token, LinkedIn `403` insufficient permissions).
- **Response**:
  - **Do not retry**. Mark job as `failed: permanent`.
  - Emit internal event `auth.deauthorized`.
  - `User_Service` updates the connected account `connectionStatus: invalid`.
  - `Notification_Service` pushes real-time WebSocket alert and email to the user to re-authenticate.

### 5. Platform Degradation (5xx / Timeouts)
- **Detection**: `500`, `502`, `503`, or socket timeout > 30s.
- **Response**:
  - Retry up to 3 times with linear backoff (`5s`, `10s`, `15s`).
  - If all retries fail, set Redis `platform:{platform}:degraded` with TTL 10 minutes.
  - During degradation, `Job_Service` holds jobs in `ready` state; `Publish_Service` rejects new attempts until the flag expires or a manual health check passes.

## Scaling Considerations

- **Distributed Atomic Counters**: Because `Publish_Service` runs as a horizontally scalable Node.js cluster, per-user counters use Redis `INCR` and Lua-based token bucket scripts to eliminate race conditions during concurrent bursts.
- **Queue Partitioning**: Agenda.js jobs are tagged with `userId` and `platform`. `Job_Service` enforces per-user concurrency caps (e.g., max 2 simultaneous publish jobs per user) so that one high-volume account cannot exhaust the global worker pool or its own API quota in seconds.
- **Tier Isolation**: Credentials and rate-limit buckets for different platform tiers (e.g., Twitter Basic vs. Pro) are fully isolated. A Basic-tier app hitting its monthly cap must not block Pro-tier users.
- **Redis Clustering**: `ratelimit:*` keys are hashed by `{platform}` tag to ensure related user and app keys land in the same Redis slot, allowing efficient multi-key Lua operations.
- **Observability Metrics**: Prometheus exporters in `Publish_Service` emit `platform_api_remaining_ratio` and `platform_publish_errors_total` labeled by `platform` and `error_type`. Alertmanager evaluates these for automatic circuit breaking.

## Operational Playbooks

### Investigating a Sudden 429 Spike
1. Query logs for `statusCode:429` aggregated by `platform` and `endpoint` over the last 15 minutes.
2. Compare Redis `ratelimit:*` counters against MongoDB `platform_api_states` to detect counter drift.
3. Identify the top 5 users by call volume:
   ```js
   db.publish_attempts.aggregate([
     { $match: { statusCode: 429, recordedAt: { $gte: new Date(Date.now() - 15*60*1000) } } },
     { $group: { _id: "$userId", count: { $sum: 1 } } },
     { $sort: { count: -1 } },
     { $limit: 5 }
   ])
   ```
4. If a single user dominates, verify their `postingFrequency` in `User_Service` is not misconfigured to sub-minute intervals.
5. If app-level, check for a runaway loop in `Content_Service` generating duplicate jobs for the same post.
6. Mitigate: Lower `PUBLISH_{PLATFORM}_CONCURRENCY` env var and redeploy `Publish_Service` pods gradually.

### Recovering from an App-Level Platform Block
1. Log in to the platform developer dashboard (Meta for Business, Twitter Developer Portal, etc.) and confirm the block reason and expiry.
2. Halt all non-critical outbound jobs:
   ```js
   agenda.cancel({ name: /publish:.*/, 'data.platform': '<platform>', 'data.critical': { $ne: true } });
   ```
3. Set a global circuit: `SET circuit:{platform}:app:tier:{tierId} open EX 3600`.
4. Trigger `Notification_Service` to send a bulk email to all affected users explaining the delay.
5. After the platform lifts the block, restore concurrency in stages (10% → 50% → 100%) over 30 minutes while watching error rates.

### Onboarding a New Platform Tier or API Key
1. Register the new app in the external developer portal.
2. Store credentials in `Auth_Service` vault with metadata `{ platform, tierId }`.
3. Insert a baseline config document into `platform_tier_configs`.
4. Initialize the Redis token bucket:
   ```
   HSET ratelimit:{platform}:app:tier:{tierId}:bucket tokens {limit} last_refill {now}
   ```
5. Deploy `Publish_Service` with the updated credential pool.
6. Run a dry-run Agenda.js job (`dryRun: true`) that calls the platform’s least expensive endpoint to validate header parsing and rate-limit recording.

## Related Diagrams

- `diagrams/002/iter1_overview.mmd`