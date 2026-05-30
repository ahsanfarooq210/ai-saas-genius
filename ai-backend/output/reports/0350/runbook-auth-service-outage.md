# Auth Service Outage Runbook

## Scope
This runbook covers total or partial failure of the `auth_service`, the component responsible for OAuth 2.0 flows, token refresh cycles, and session management for social platform connections. It is considered a **cross-cutting** outage because `api_gateway`, `job_worker`, `publisher_service`, and `scheduler_service` all depend on healthy authentication and authorization state.

---

## Responsibilities
- Initiate OAuth 2.0 authorization flows for users connecting social media accounts.
- Receive and validate authorization callbacks from platform APIs, exchanging codes for access and refresh tokens.
- Maintain short-lived session state for the web dashboard and internal API consumers.
- Orchestrate proactive token refresh before platform-issued credentials expire.
- Write encrypted tokens to the `token_vault` and cache ephemeral metadata in `redis_cache`.
- Validate Bearer tokens on incoming requests (synchronously or via cached introspection) for routes proxied by `api_gateway`.

---

## APIs / Interfaces
- `POST /auth/:platform/initiate` — Returns a platform-specific redirect URL and stores an ephemeral OAuth state nonce in `redis_cache`.
- `GET /auth/:platform/callback` — Receives the authorization code, exchanges it for platform tokens, persists encrypted credentials in `token_vault`, and writes expiry metadata to `mongodb_ops`.
- `POST /auth/refresh` — Triggers a proactive refresh for a given user/platform pair; used by `scheduler_service` and internal cron loops.
- `GET /auth/session/validate` — Synchronous session validation invoked by `api_gateway` before routing to downstream services.
- `DELETE /auth/session` — Revokes the current session and invalidates the cached entry in `redis_cache`.
- **Internal to `token_vault`** — gRPC/HTTP for encrypted token CRUD and atomic compare-and-swap updates.
- **Internal to `redis_cache`** — Reads/writes for session caching, OAuth state nonces, and rate-limit counters.
- **Internal to `mongodb_ops`** — Reads from the `User` and `PlatformConfig` collections.

---

## Data Owned
| Data | Store | Description |
|---|---|---|
| **OAuth state nonces** | `redis_cache` | Ephemeral CSRF-protection keys with a TTL of ~10 minutes. |
| **Session tokens** | `redis_cache` | Opaque or JWT session references cached with a TTL. |
| **Token expiry metadata** | `mongodb_ops` | `expires_at`, `scope`, `platform_user_id`, and refresh scheduling windows. |
| **OAuth app credentials** | `mongodb_ops` | Client IDs and secrets per platform (stored in `PlatformConfig`, never hard-coded). |
| **Encrypted user tokens** | `token_vault` | The `auth_service` orchestrates writes, but the vault is the authoritative owner. |

---

## Failure Modes
| Mode | Symptoms | Blast Radius |
|---|---|---|
| **Auth service pods unhealthy** | `api_gateway` returns 502/503 on login or callback paths; health checks fail. | New account connections impossible. Dashboard session validation fails. |
| **Redis partition / eviction** | Latency spikes on `/auth/session/validate`; OAuth callbacks return 401 due to state mismatch. | Session validation degrades; OAuth flows abort. |
| **MongoDB ops latency** | Auth requests timeout during callback handling or user lookup. | New connections cannot be persisted; callback state machines stall. |
| **Token vault unreachable** | Refresh operations throw 500 or silently fail; logs show vault connection errors. | `publisher_service` will eventually hit platform API 401s as tokens expire. |
| **Dependency cascade** | `api_gateway` circuit breaker opens to `auth_service`. | All authenticated traffic is rejected; the dashboard and API appear fully down. |

---

## Detection & Alerting
- **Error rate**: `auth_service` aggregate 5xx rate exceeds 1% for 2 consecutive minutes.
- **Latency**: p99 on `/auth/session/validate` exceeds 2 seconds.
- **Dependency health**: Connection pool saturation alerts for `redis_cache` or `mongodb_ops`.
- **Business metric**: OAuth callback success rate drops below 95%.
- **Downstream signal**: `publisher_service` token-refresh failure rate spikes, or `job_worker` logs increase in vault read errors.

---

## Impact Assessment
1. **Immediate (0–5 min)**: Users cannot link new social accounts or re-authenticate. Existing dashboard sessions may fail if validation is synchronous and uncached.
2. **Near-term (5 min – hours)**: Scheduled publish jobs continue **only if** tokens in `token_vault` remain valid. Risk accumulates linearly as platform token expiry windows approach.
3. **Critical**: If the outage exceeds the remaining TTL of platform access tokens (ranging from 60 minutes to 60 days depending on the platform), automated publishing halts entirely because `publisher_service` cannot obtain fresh credentials.
4. **Data integrity**: No permanent data loss is expected. OAuth state nonces in `redis_cache` expire naturally, and MongoDB documents are durable.

---

## Immediate Mitigation (0–5 min)
1. **Confirm blast radius**:
   ```bash
   kubectl get pods -l app=auth-service -o wide
   kubectl logs -l app=auth-service --tail=500 | grep -E "(ERROR|FATAL|timeout)"
   ```
2. **Scale horizontally** if pods are crash-looping or CPU-throttled:
   ```bash
   kubectl scale deployment auth-service --replicas=10
   ```
   The service is stateless; new pods serve traffic immediately because session state lives in `redis_cache`.
3. **Reduce load on validation path**: If a feature flag exists, instruct `api_gateway` to accept locally validated JWT signatures without calling `auth_service` for a short grace period (e.g., 5 minutes).
4. **Reset circuit breaker**: If `api_gateway` has opened its circuit breaker to `auth_service`, force a half-open test:
   ```bash
   # Example via control-plane CLI
   api-gateway cb half-open --target=auth-service
   ```

---

## Recovery Procedures (5–30 min)
1. **Verify dependencies**:
   - `redis_cache`: `redis-cli -h <host> ping`; check `used_memory` and `evicted_keys`.
   - `mongodb_ops`: Confirm replica set primary availability and that the `auth_service` connection pool is not exhausted.
   - `token_vault`: Verify its health endpoint and that the encryption key provider (HSM/KMS) is responsive.
2. **Rollback**:
   - If the outage correlates with a recent deployment, rollback immediately:
     ```bash
     kubectl rollout undo deployment/auth-service
     ```
3. **Backfill token refreshes**:
   - Once stable, enqueue a targeted refresh batch via `scheduler_service` for all users whose token expiry fell inside the outage window:
     ```bash
     curl -X POST https://scheduler-service.internal/v1/backfill/refresh \
       -H "Authorization: Bearer $OPS_TOKEN" \
       -d '{"lookback_minutes": 60, "platforms": ["all"]}'
     ```
4. **Cleanup**:
   - If `redis_cache` experienced evictions, scan for orphaned `oauth:state:*` keys and delete them to prevent memory pressure:
     ```bash
     redis-cli --scan --pattern "oauth:state:*" | xargs -L 100 redis-cli del
     ```

---

## Scaling Considerations
- **Horizontal Pod Autoscaler**: Baseline 3 pods; scale on CPU > 70% and custom metric `auth_validation_rps`. Maximum 20 pods. Scale-out should be rapid because pods are stateless.
- **Redis thundering herd**: During recovery, a surge of re-logins can spike `redis_cache` memory and connection count. Enable replica reads for session validation and ensure the cluster has enough headroom.
- **Token vault load**: A recovery refresh storm can hammer `token_vault`. Ensure `scheduler_service` uses batch/buffered refresh rather than per-request refresh, and that vault connection pooling is sized for burst traffic.
- **MongoDB query patterns**: During high-volume OAuth callbacks, ensure the `User` collection query on `(platform, platform_user_id)` is covered by an index to prevent COLLSCAN under load.

---

## Post-Incident Validation
1. **Health**: `curl -f https://api-gateway.example.com/healthz` returns HTTP 200.
2. **End-to-end OAuth**: Complete a full account connection flow for one social platform in staging/production.
3. **Token refresh**: Force a refresh for a test user; verify the new token is written to `token_vault` and `expires_at` is updated in `mongodb_ops`.
4. **Publish path**: Confirm `job_worker` can read a token from `token_vault` and that `publisher_service` successfully submits a post to a platform API.
5. **Metrics**: Confirm p99 latency on `/auth/session/validate` is < 200 ms and 5xx rate is < 0.1% for 10 minutes.

---

## Escalation
- **L1 — On-call SRE**: Pod scaling, rollback, dependency health checks, and circuit-breaker management.
- **L2 — Backend Platform Team**: Code-level regressions, OAuth flow logic bugs, and `token_vault` encryption issues.
- **L3 — Security / Infrastructure**: HSM/KMS failures, `mongodb_ops` replica set failures, or suspected credential compromise.

---

## Related Diagrams
- `diagrams/0350/iter4_overview.mmd`