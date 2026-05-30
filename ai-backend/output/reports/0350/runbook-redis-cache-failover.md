# Runbook: Redis Cache Failover

## 1. Scope & Criticality
This runbook covers operational failover, recovery, and degraded-mode procedures for the `redis_cache` component in the social media automation platform. Redis serves as the distributed state layer for rate limiting, circuit breakers, OAuth token metadata, user preference caching, presigned URL staging, idempotency locks, and per-user worker concurrency semaphores. A Redis outage does not destroy the primary operational data (source of truth remains MongoDB and the encrypted token vault), but it can halt publishing pipelines, trigger duplicate posts, or cause platform API rate-limit violations if not handled with strict fallback policies.

## 2. Architectural Responsibilities & Downstream Impact

| Dependent Service | Cached / Stored Data | Impact if Redis Unavailable |
|---|---|---|
| **auth_service** | OAuth flow state (`oauth:state:*`), session bindings | New social account connections fail mid-flow; existing sessions fall back to MongoDB session store with increased latency. |
| **token_vault** | Token metadata & versioning cache (`token:meta:*`) | Every token read becomes a direct vault decryption; latency increases by 50–150 ms but remains functional. |
| **scheduler_service** | User preference snapshots (`user:prefs:*`), scheduling locks | Scheduler reads preferences from MongoDB; duplicate schedule generation is possible if scheduling locks are lost. |
| **rate_limiter** | Token bucket counters (`ratelimit:*`) | Distributed rate limiting collapses. Must fail-closed to avoid platform API bans. |
| **circuit_breaker** | Global circuit state per platform (`circuit:*`) | Workers lose global visibility; local in-memory circuit breakers activate with tighter thresholds. |
| **publisher_service** | Idempotency keys (`idempotency:*`), publish status staging | Risk of duplicate posts if outbox pattern in MongoDB is not consulted before platform API calls. |
| **job_worker** | Per-user concurrency locks (`worker:lock:*`), deduplication bloom filters | Concurrency limits are lost; risk of over-publishing to a single account. |
| **media_processor** | Transcoding job progress & temp metadata (`media:proc:*`) | Workers may restart completed jobs unless idempotency is enforced via MongoDB job state. |

## 3. Cache Data Inventory & Key Patterns

| Key Pattern | Data Type | TTL | Source of Truth | Notes |
|---|---|---|---|---|
| `oauth:state:{nonce}` | String | 10 min | MongoDB (transient) | OAuth 2.0 PKCE / state parameter |
| `token:meta:{userId}:{platform}` | Hash | 5 min | Token Vault (MongoDB + KMS) | Version, expiry, refresh token hint |
| `user:prefs:{userId}` | JSON (String) | 15 min | MongoDB (`users.preferences`) | Posting frequency, captions, hashtags, time windows |
| `media:presign:{objectKey}` | String | 55 min | Object Storage (S3) | S3 presigned GET/PUT URL; regenerate on miss |
| `ratelimit:{platform}:{accountId}:{window}` | String (float) | Window size (60 s – 15 min) | Derived from platform API headers | Token bucket remaining capacity |
| `circuit:{platform}` | Hash | 30 s (closed) / 5 min (open) | Derived from error rates | State (`OPEN`, `CLOSED`, `HALF_OPEN`), failure count, last failure timestamp |
| `idempotency:{publishJobId}` | String | 24 h | MongoDB outbox (`published_posts`) | Prevents duplicate platform API calls |
| `worker:lock:{userId}` | String (jobId) | 5 min | Redis only | Per-user concurrency semaphore; max 1–N per user |
| `session:{sessionId}` | Hash | 24 h | MongoDB session collection | Express session data if `connect-redis` is enabled |

## 4. Failure Mode Matrix

### 4.1 Primary Node Failure (Redis Sentinel)
- **Symptom**: Sentinel detects `+sdown` then `+odown` on the master; replicas attempt promotion.
- **Impact**: Brief write unavailability (1–30 s) until Sentinel elects a new primary. Reads may briefly serve stale data from replicas.
- **System Behavior**: Node.js Redis clients (ioredis) should auto-reconnect to the new primary via Sentinel discovery.

### 4.2 Network Partition / Split Brain
- **Symptom**: Two nodes claim to be master; clients write to both sides of the partition.
- **Impact**: Divergent rate-limit counters, duplicate idempotency keys, or conflicting circuit breaker states.
- **Risk**: After healing, data inconsistency can allow bursts past platform limits or duplicate publishes.

### 4.3 Complete Cache Outage (All Redis Nodes Unreachable)
- **Symptom**: `ECONNREFUSED` / timeout from all services; P99 latency spikes as services retry.
- **Impact**:
  - **Rate Limiter**: Cannot count tokens. Policy is **fail-closed**; `publisher_service` and `job_worker` must pause outbound publish jobs.
  - **Circuit Breaker**: No global state. Workers use local in-memory circuit breakers (default: open after 5 errors in 30 s, vs. 50 errors in 2 min globally).
  - **Auth**: New OAuth flows fail; existing sessions fall back to MongoDB.
  - **Scheduler**: Reads preferences directly from MongoDB; no data loss.

### 4.4 Cache Poisoning / Stale Data
- **Symptom**: Users see old preferences, expired presigned URLs, or incorrect rate-limit headroom.
- **Impact**: Failed media uploads, rejected posts, or premature rate-limit throttling.
- **Mitigation**: Emergency key flush by pattern or TTL-based eviction.

## 5. Detection & Alerting

Monitor the following metrics and logs:

- **`redis_cache:up`**: Health check ping every 10 s. Alert if > 2 failures in 30 s.
- **`redis_replication_lag_seconds`**: Alert if > 5 s for any replica.
- **`redis_connected_clients`**: Alert if approaching `maxclients` (e.g., > 90 %).
- **`redis_memory_used_percent`**: Alert if > 85 %; critical if > 95 %.
- **Application metrics**:
  - `cache_miss_rate` spike > 90 %
  - `redis_command_latency_p99` > 100 ms
  - `rate_limiter_redis_error_rate` > 1 %
  - `publisher_idempotency_collision_count` > 0 (indicates split brain or flush)

Log query (example):
```bash
# Search for Redis connection errors across the Node.js fleet
kubectl logs -l app=job-worker --tail=500 | grep -i "ECONNREFUSED\|Redis connection lost\|ioredis"
```

## 6. Failover Procedures

### 6.1 Sentinel-Managed Primary Failure

1. **Verify Sentinel quorum**:
   ```bash
   redis-cli -p 26379 SENTINEL ckquorum redis-cache-primary
   ```
   If quorum is lost, do **not** proceed with manual failover until at least `(N/2)+1` Sentinels are reachable.

2. **Identify the current master**:
   ```bash
   redis-cli -p 26379 SENTINEL get-master-addr-by-name redis-cache-primary
   ```

3. **Check replication status on the master** (if reachable):
   ```bash
   redis-cli INFO replication
   ```
   Ensure `master_repl_offset` is synchronized with replicas before forcing failover.

4. **Force failover** (only if auto-failover did not occur within 60 s):
   ```bash
   redis-cli -p 26379 SENTINEL failover redis-cache-primary
   ```

5. **Verify promotion**:
   ```bash
   redis-cli -p 26379 SENTINEL get-master-addr-by-name redis-cache-primary
   redis-cli -h <new-master-ip> -p 6379 INFO replication | grep role
   ```
   Expected: `role:master`

6. **Validate application reconnection**:
   - Check `job_worker`, `publisher_service`, and `rate_limiter` logs for `ready` or `connect` events from ioredis.
   - Confirm write operations succeed:
     ```bash
     redis-cli -h <new-master-ip> SET runbook:failover:check $(date +%s) EX 60
     ```

### 6.2 Network Partition / Split Brain

1. **Pause writes** by enabling the degraded mode flag `REDIS_CACHE_ENABLED=false` in `api_gateway` and all downstream services to prevent further divergence.
2. **Inspect `INFO replication`** on all nodes. Identify the node with the highest `master_repl_offset` or `run_id`.
3. **On the legitimate primary**, issue:
   ```bash
   redis-cli CONFIG SET min-replicas-to-write 1
   ```
4. **On the illegitimate primary** (partitioned side), stop Redis process to prevent client writes:
   ```bash
   redis-cli DEBUG SEGFAULT   # emergency kill, or use systemd: systemctl stop redis
   ```
   *Note: Ensure this node is not serving live traffic before stopping.*
5. **Heal the partition**, restart the stopped node, and verify it rejoins as a replica:
   ```bash
   redis-cli SLAVEOF <legitimate-master-ip> 6379
   ```
6. **Clear potentially inconsistent keys**:
   ```bash
   redis-cli --scan --pattern 'ratelimit:*' | xargs -L 100 redis-cli DEL
   redis-cli --scan --pattern 'circuit:*' | xargs -L 100 redis-cli DEL
   ```
7. **Re-enable** `REDIS_CACHE_ENABLED=true` and monitor `publisher_idempotency_collision_count`.

### 6.3 Complete Cache Outage (All Nodes Down)

1. **Activate Degraded Mode** immediately via feature flags (see §7).
2. **Halt non-critical publish pipelines**:
   - Pause `job_worker` consumption from `redis_streams_queue` for publish tasks to prevent thundering herd against platform APIs without rate limiting.
   - Allow media processor tasks to continue only if they use MongoDB for progress tracking and do not depend on Redis locks.
3. **Redirect auth sessions** to MongoDB-backed store (`express-session` with MongoDB connector).
4. **Notify on-call platform team**; do **not** restart workers repeatedly, as this amplifies connection storm when Redis returns.
5. **Recover Redis nodes** using infrastructure playbooks (e.g., EBS volume re-attachment, pod rescheduling, or VM replacement).
6. **Before re-enabling services**:
   - Verify Redis accepts writes.
   - Warm critical caches (see §8).
   - Disable degraded mode flags sequentially: `rate_limiter` first, then `circuit_breaker`, then `job_worker`.

### 6.4 Cache Poisoning / Stale Key Flush

If bad data is written (e.g., incorrect preference snapshot):

1. **Identify the key pattern** from application logs.
2. **Delete by pattern** (use `redis-cli --scan` in production to avoid `KEYS` blocking):
   ```bash
   redis-cli --scan --pattern 'user:prefs:{affectedUserId}*' | xargs redis-cli DEL
   ```
3. **For rate-limit counters** (if poisoned by clock skew or split brain):
   ```bash
   redis-cli --scan --pattern 'ratelimit:*' | xargs -L 500 redis-cli DEL
   ```
4. **Verify** that the next request repopulates from source of truth (MongoDB / Token Vault).

## 7. Degraded Mode Configuration

Set the following environment variables / feature flags during an outage. Changes take effect via Consul / etcd / env reload without deployment.

| Flag | Normal Value | Degraded Value | Effect |
|---|---|---|---|
| `REDIS_CACHE_ENABLED` | `true` | `false` | Disables all cache reads/writes; services read directly from MongoDB or Token Vault. |
| `RATE_LIMITER_FAIL_OPEN` | `false` | `false` (keep) | **Never set to `true` during an outage.** If Redis is down, rate limiter returns "limit exceeded" (fail-closed). |
| `CIRCUIT_BREAKER_LOCAL_FALLBACK` | `true` | `true` | Workers use in-memory circuit breaker maps when Redis unreachable. |
| `WORKER_CONCURRENCY_LOCAL_MAX` | `0` (unlimited local) | `1` | Restricts each worker instance to 1 concurrent job per `userId` when distributed `worker:lock:*` is unavailable. |
| `PUBLISHER_IDEMPOTENCY_MONGO_CHECK` | `false` (Redis only) | `true` | Forces `publisher_service` to query MongoDB outbox before every platform API call. |
| `AUTH_SESSION_STORE` | `redis` | `mongodb` | Switches Express session backend to MongoDB. |

## 8. Post-Incident Recovery & Cache Warming

After Redis is fully restored and consistent:

1. **Reset local worker state**: Restart `job_worker` and `media_processor` pods to clear in-memory circuit breakers and local concurrency maps.
2. **Warm user preferences**:
   ```bash
   # One-time script run from scheduler_service node
   node scripts/warm-cache.js --pattern 'user:prefs' --source mongodb --ttl 900
   ```
   Target active users (scheduled in next 24 h) first.
3. **Warm token metadata**:
   ```bash
   node scripts/warm-cache.js --pattern 'token:meta' --source token_vault --ttl 300
   ```
4. **Rehydrate presigned URLs**: Not pre-warmed; regenerate on first `media_service` request.
5. **Reset rate limit counters**: Allow natural refill from platform API response headers. Do **not** pre-seed arbitrary values.
6. **Verify end-to-end**:
   - Schedule a test post via `api_gateway`.
   - Confirm `job_worker` acquires `worker:lock:*`.
   - Confirm `rate_limiter` decrements `ratelimit:*`.
   - Confirm `publisher_service` writes `idempotency:*` and MongoDB outbox.
   - Confirm post appears on target social platform exactly once.

## 9. Scaling & Topology Considerations

- **High Availability**: Run Redis in **Sentinel mode** (1 primary, 2 replicas, 3 Sentinels) for the operational cache. This handles primary failure automatically for the majority of single-key workloads (rate limits, locks, preferences).
- **Sharding**: If `redis_memory_used` exceeds 70 % of instance RAM due to large idempotency or presigned URL keyspaces, migrate to **Redis Cluster** with hash tags for related keys (e.g., `{userId}:prefs`, `{userId}:locks`) to ensure locality.
- **Connection Management**: Use `ioredis` with `enableOfflineQueue: false` in `publisher_service` and `job_worker` to prevent unbounded memory growth during partitions. Set `maxRetriesPerRequest: 3` and `retryStrategy` with exponential backoff capped at 2 s.
- **Persistence**: Disable AOF/RDB on the cache layer; this is a transient store. The sole exception is if Sentinel failover timing causes unacceptable cold-start latency—then use RDB snapshots every 15 min on replicas only.
- **Memory Sizing**: Budget ~2× the peak working set size. Example: 100 k active users × 5 platforms × 2 KB average key/value = ~1 GB; provision 2 GB with `maxmemory-policy allkeys-lru`.
- **TLS**: Encrypt traffic between Node.js services and Redis, especially for `auth_service` and `token_vault` keys.

## Related Diagrams

- `diagrams/0350/iter4_overview.mmd` — System architecture overview showing all services dependent on `redis_cache`.