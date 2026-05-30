# Rate Limiter

## Responsibilities

The Rate Limiter is an internal policy enforcement layer that protects connected social media accounts from platform-side throttling and bans. Its specific duties include:

- **Quota Enforcement** – Intercepting every outbound publishing request from the `platform_connector` to verify that the operation will not exceed the account-level or app-level limits imposed by the target social network.
- **Window Tracking** – Maintaining accurate, time-bound usage counters (fixed or sliding windows) per `(platform, accountId, operationType)` tuple.
- **Atomic Consumption** – Guaranteeing that concurrent Agenda.js workers do not overshoot a limit through race conditions.
- **Backpressure Signaling** – Returning structured `retryAfter` metadata so that the `scheduler_service` can defer an Agenda.js job rather than dropping it.
- **Dynamic Policy Management** – Storing platform-specific limit rules in MongoDB so that operators can adjust quotas without deploying new code when APIs change their rate policies.
- **Audit Logging** – Recording rejected requests and near-limit events to support post-mortem analysis and alerting.

## APIs / Interfaces

The Rate Limiter does not expose REST endpoints through the API Gateway. It is consumed as an internal Node.js module by the `platform_connector`.

```typescript
interface RateLimiter {
  /**
   * Atomically attempts to reserve quota for an outbound request.
   * Returns success=false if the limit is exhausted.
   */
  consume(params: {
    platform: 'instagram' | 'twitter' | 'facebook' | 'linkedin';
    accountId: string;
    operation: 'media_upload' | 'post_publish' | 'story_publish' | 'metadata_read';
    requestedTokens?: number; // default 1
  }): Promise<{
    success: boolean;
    remaining: number;
    resetAt: Date;
    retryAfterMs: number;
  }>;

  /**
   * Peek at current quota without modifying it.
   */
  checkQuota(params: {
    platform: string;
    accountId: string;
    operation: string;
  }): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }>;

  /**
   * Refund tokens when the downstream API call fails before actual
   * platform consumption (e.g., network timeout on a non-idempotent
   * upload). Use sparingly.
   */
  refund(params: {
    platform: string;
    accountId: string;
    operation: string;
    tokens?: number;
  }): Promise<void>;

  /**
   * Update limit rules for a platform. Called by admin tooling
   * or by automated policy importers.
   */
  setPlatformConfig(
    platform: string,
    rules: Array<{
      operation: string;
      windowSeconds: number;
      maxTokens: number;
    }>
  ): Promise<void>;
}
```

### Consumption Flow

1. The `platform_connector` receives a publish job payload from the `scheduler_service`.
2. Before dispatching to the external social API, it calls `rateLimiter.consume()`.
3. If `success` is `true`, the connector proceeds with the HTTP request.
4. If `success` is `false`, the connector aborts and returns a rate-limit error. The `scheduler_service` catches this and reschedules the Agenda.js job using `job.schedule(retryAfterMs)`.
5. If the external API unexpectedly responds with HTTP 429, the connector may optionally call `refund()` depending on whether the platform already metered the request.

## Data Owned

All state lives in MongoDB. The Rate Limiter owns the following collections:

### `rate_limit_configs`
Immutable-or-infrequently-changed rule definitions per platform and operation.

```json
{
  "_id": ObjectId("..."),
  "platform": "instagram",
  "operation": "post_publish",
  "windowSeconds": 3600,
  "maxTokens": 25,
  "createdAt": ISODate("2024-01-01T00:00:00Z"),
  "updatedAt": ISODate("2024-06-01T00:00:00Z")
}
```

### `rate_limit_windows`
Mutable counter state for each active billing window.

```json
{
  "_id": ObjectId("..."),
  "platform": "instagram",
  "accountId": "user_abc_ig",
  "operation": "post_publish",
  "windowStart": ISODate("2024-01-15T14:00:00Z"),
  "consumed": 7,
  "lastConsumedAt": ISODate("2024-01-15T14:23:00Z")
}
```

- **Unique Compound Index**: `{ platform: 1, accountId: 1, operation: 1, windowStart: 1 }`
- **TTL Index**: `{ windowStart: 1 }` with `expireAfterSeconds` set to the platform's maximum window duration plus a 24-hour safety buffer. This prevents unbounded growth.

### `rate_limit_violations`
Append-only audit of throttled requests.

```json
{
  "platform": "twitter",
  "accountId": "user_xyz_tw",
  "operation": "media_upload",
  "requestedTokens": 4,
  "windowLimit": 50,
  "windowConsumed": 52,
  "requestedAt": ISODate("2024-01-15T14:25:00Z"),
  "schedulerJobId": "agenda:job:64f8a2...",
  "refunded": false
}
```

## Failure Modes

| Failure Scenario | Impact | Mitigation |
|---|---|---|
| **MongoDB primary unavailable** | The Rate Limiter cannot read windows or commit consumption. | Fail-closed by default: reject `consume()` calls. This protects external accounts from ban risk at the cost of temporary publishing stalls. The `platform_connector` must surface the failure so Agenda.js retries the job with exponential backoff. |
| **Race condition on hot documents** | Two workers check quota simultaneously, both see remaining capacity, and both issue `$inc`, breaching the limit. | Never read-then-write. All quota checks for consumption use MongoDB `findOneAndUpdate` with `$inc` on the `consumed` field and a match condition ensuring `consumed + requestedTokens <= maxTokens`. |
| **Clock skew across nodes** | Workers compute different `windowStart` boundaries, allowing limits to be bypassed or prematurely enforced. | Synchronize all nodes with NTP. Compute `windowStart` by rounding the server timestamp down to the nearest `windowSeconds` interval using UTC. Do not trust client-provided timestamps. |
| **Stale platform limits** | A social network lowers its rate limit unannounced. The system continues issuing requests at the old, higher threshold. | When the `platform_connector` receives HTTP 429 from a platform, it must capture the `Retry-After` header (if present) and feed it back to the Rate Limiter. A temporary penalty document is inserted to block consumption for that account until the retry window passes. Operators are alerted to update `rate_limit_configs`. |
| **Hot-document write pressure** | A single high-volume account concentrates all writes onto one `rate_limit_windows` document. | Shard the collection by `accountId` if the MongoDB cluster is sharded. Keep documents schemaless and small; avoid embedding historical arrays in the hot path. |
| **Memory pressure from orphaned windows** | Without cleanup, expired window documents accumulate. | Rely on the TTL index for automatic pruning. Additionally, run a nightly compaction job that removes any windows whose `windowStart` is older than the longest configured platform window plus 48 hours. |

## Scaling Considerations

- **Stateless Workers** – The Rate Limiter holds no in-memory state. Any instance of the `platform_connector` can invoke it, allowing the worker pool to scale horizontally without sticky sessions.
- **Database Write Amplification** – Every outbound API call generates at least one MongoDB write (`$inc` on `consumed`). At high publish volumes, this creates sustained write load on the primary node. Mitigations include:
  - Using WiredTiger compression to reduce disk I/O on the small counter documents.
  - Routing `checkQuota` reads to secondary nodes if stale reads of a few milliseconds are acceptable, while keeping writes on the primary.
- **Sharding Strategy** – If the primary replica set saturates, shard `rate_limit_windows` by `accountId`. `rate_limit_configs` and `rate_limit_violations` can remain unsharded or use a hashed shard key because their volume is comparatively low.
- **Batch Consumption** – When the `scheduler_service` processes bulk jobs, the Rate Limiter should support multi-document atomic batches (e.g., consuming quota for multiple accounts in a single ordered bulk write) to reduce network round-trips.
- **Adaptive Backoff** – Integrate closely with `platform_connector` HTTP responses. If a platform returns HTTP 429 with an `x-rate-limit-remaining: 0` header, the Rate Limiter should treat this as a ground-truth override and immediately create a penalty window that blocks further consumption for that account until the header's reset time.

## Related Diagrams

No paired Mermaid diagram was provided for this document.