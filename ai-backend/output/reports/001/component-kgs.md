# KGS (Key Generation Service)

## Responsibilities

- **Atomic Range Allocation**: Reserves contiguous blocks of integer counters from MongoDB using atomic `findAndModify($inc)`. Each block maps to a unique set of Base58 short codes.
- **Generation-Race Prevention**: Eliminates the need for the `URLService` to check for collisions or rely on a cross-shard unique index on `shortCode` in the main URLs collection.
- **Short-Code Uniqueness Guarantee**: By doling out non-overlapping counter ranges, KGS ensures that two `URLService` instances can never produce the same short code, even under high concurrency or across MongoDB shards.
- **Key-Space Isolation**: Supports distinct counter namespaces (e.g., `default`, `custom-premium`) so that different URL pools or tenants draw from independent sequences.

## API & Interfaces

### `POST /v1/ranges/allocate`

Internal endpoint consumed exclusively by `URLService`.

**Request**
```json
{
  "batchSize": 1000,
  "keySpace": "default"
}
```

Constraints:
- `batchSize`: integer, `1 ≤ batchSize ≤ 10000`.
- `keySpace`: string, defaults to `"default"`.

**Response — `200 OK`**
```json
{
  "keySpace": "default",
  "rangeStart": 150000000,
  "rangeEnd": 150000999,
  "allocatedAt": "2024-05-20T14:34:00Z"
}
```

`URLService` treats `rangeStart` and `rangeEnd` as an inclusive integer interval. It maintains a local in-memory cursor inside this interval, encodes each integer to Base58 before inserting the URL document, and requests a new range only after exhausting the current one.

**Error Responses**
- `503 Service Unavailable` — MongoDB primary is unreachable or `findAndModify` timed out. KGS fails fast; it does not queue or retry internally.
- `400 Bad Request` — `batchSize` out of bounds or `keySpace` contains invalid characters.

### `GET /health`

Liveness/readiness probe used by the Kubernetes orchestrator.

- Returns `200` only if the Node.js process can execute a no-op `findAndModify` against the `kgs.counters` collection within `500 ms`.
- Returns `503` on MongoDB driver timeout or primary-stepdown detection.

### Consumer Contract (`URLService`)

`URLService` pods must:
1. Cache allocated ranges in local memory and only call KGS on exhaustion.
2. Encode integers to Base58 independently; KGS returns raw numeric ranges to minimize payload size.
3. Wrap KGS calls in a circuit breaker (failure threshold 5, timeout 2 s) to prevent cascading overload during a MongoDB failover.

## Data Ownership

### `kgs.counters` (MongoDBCluster)

A dedicated collection holding atomic counter documents.

```javascript
{
  _id: "default",                 // keySpace identifier
  seq: NumberLong(150000000)      // next integer to be allocated (exclusive upper bound)
}
```

- One document per `keySpace`.
- KGS updates the document with `findAndModify({ _id: keySpace }, { $inc: { seq: batchSize } })`, returning the pre-update value. The reserved interval is `[oldSeq, oldSeq + batchSize - 1]`.
- Stored as `NumberLong` (64-bit) to avoid `MAX_SAFE_INTEGER` limits in Node.js.

### `kgs.allocations` (MongoDBCluster) — optional audit

Append-only log for operational debugging.

```javascript
{
  _id: ObjectId("..."),
  keySpace: "default",
  rangeStart: NumberLong(150000000),
  rangeEnd: NumberLong(150000999),
  consumerHost: "url-service-7f8d9b-4k2p1",
  allocatedAt: ISODate("2024-05-20T14:34:00Z")
}
```

Not required for correctness; can be omitted if write amplification is a concern.

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **MongoDB primary failover** | KGS cannot perform atomic `$inc`. Allocation requests return `503`. | Use MongoDB driver `serverSelectionTimeoutMS: 2000`. `URLService` circuit breaker opens, causing new-URL creation to fail fast while redirects (read-only) continue unaffected. |
| **Single counter-document hotspot** | Thousands of `URLService` pods simultaneously requesting small ranges can bottleneck the single document holding `seq`. | Maintain a pool of counter shards (e.g., `counter-0` … `counter-7`). KGS randomly selects a shard per request. Uniqueness is preserved across the union; sequence gaps are acceptable. |
| **Orphaned/wasted ranges** | A `URLService` pod crashes or is scaled down before exhausting its local range, leaving unused short codes. | Acceptable entropy. Mitigate by tuning `batchSize` relative to pod churn (e.g., 1 000–5 000 codes per allocation). Do not implement range-reclamation logic; 64-bit space is effectively inexhaustible. |
| **Range exhaustion on URLService** | A pod exhausts its local range during a KGS network partition and cannot create new URLs. | `URLService` should request a new range at a low-water mark (e.g., when 10 % remains) and keep a micro-reserve (e.g., last 50 codes) for graceful drain. |
| **Counter overflow** | Theoretically, `seq` exceeds 2⁶³−1. | Practically impossible at human-scale traffic. Schema validation enforces `NumberLong` and alerts if `seq` crosses 10¹⁵. |

## Scaling Considerations

- **Horizontal Pod Autoscaling**: KGS is fully stateless. Scale the Node.js deployment horizontally based on CPU or custom metrics (`kgs_allocations_total` rate). No sticky sessions or data migration required.
- **MongoDB Write Volume**: The write rate to `kgs.counters` equals `(URL creation rate) / batchSize`. With a conservative `batchSize` of 1 000 and 10 000 URLs/second, KGS writes to MongoDB at only 10 ops/second. This is negligible compared to the OLTP load on the main URL collection.
- **No Redis or Cache Layer**: KGS does not interact with `RedisCluster`. This removes cache invalidation complexity and keeps the hot-path dependency graph minimal.
- **Retry Semantics**: `URLService` retries on transient `502/503`. Because `findAndModify($inc)` is not idempotent for the caller, a retry simply yields an additional disjoint range. `URLService` must be prepared to absorb extra ranges rather than attempt de-duplication.
- **Observability**: Expose Prometheus metrics:
  - `kgs_allocations_total` (counter, labels: `keySpace`, `status`)
  - `kgs_allocation_latency_seconds` (histogram)
  - `kgs_mongodb_findandmodify_errors_total` (counter, label: `errorType`)

## Related Diagrams

- `diagrams/001/iter4_component-kgs.mmd`