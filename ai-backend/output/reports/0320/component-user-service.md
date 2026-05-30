# component-user-service

## Overview

The `user_service` is the domain authority for user identity metadata, posting preferences, and platform-specific account configurations within the social media automation platform. Written in Node.js/Express and backed by MongoDB, it stores everything the system needs to know about *who* is publishing and *how* they want content to behave. It serves profile data to clients, provides normalized posting rules to the `scheduler_service`, and coordinates with the `auth_service` to keep OAuth-linked social accounts in sync.

---

## Responsibilities

- **User Profile Lifecycle**  
  Create, read, update, and soft-delete user profiles that map 1:1 to an identity record in `auth_service`. Stores human-readable attributes (display name, timezone, locale, avatar) separately from authentication credentials.

- **Posting Preference Management**  
  Own the master copy of scheduling rules: target platforms, posting frequency, media-type preferences, default captions/hashtags, publishing windows, and timezone overrides. Enforces business constraints such as maximum posts per day, caption length limits, and valid time-slot permutations.

- **Linked Platform Configuration**  
  Maintain per-user, per-platform settings (e.g., Instagram story vs. feed, Twitter thread mode). Tracks which OAuth-linked accounts are active, inactive, or revoked. Applies platform-specific overrides to global defaults.

- **Settings Validation & Normalization**  
  Reject logically inconsistent configurations before they reach the scheduler (e.g., requesting five daily posts with only two time slots). Normalizes user timezones into UTC offsets for downstream job processing.

- **Cross-Service Coordination**  
  Receive provisioning and OAuth link/unlink events from `auth_service`. Expose read-optimized posting configurations to `scheduler_service`. Trigger account-deactivation side effects that pause pending Agenda.js jobs.

- **User State Governance**  
  Enforce account statuses (`active`, `deactivated`, `suspended`). Support soft-delete workflows that preserve historical audit data while halting automation.

---

## APIs and Interfaces

### External REST API (Client-Facing)

All client routes are exposed through the API Gateway, which terminates JWT authentication and forwards the canonical user identifier in the `X-User-Id` header. `user_service` does not validate tokens; it trusts the gateway.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/v1/users/me/profile` | Retrieve the current user's profile, timezone, and status. |
| `PATCH` | `/api/v1/users/me/profile` | Update mutable profile fields (`displayName`, `timezone`, `locale`, `avatarUrl`). |
| `GET` | `/api/v1/users/me/settings` | Fetch the full posting-preferences document. |
| `PUT` | `/api/v1/users/me/settings` | Replace or partially update posting preferences. Atomically increments `settingsVersion`. |
| `GET` | `/api/v1/users/me/platforms` | List all linked platform accounts and their active configuration overrides. |
| `PUT` | `/api/v1/users/me/platforms/:platformAccountId/config` | Update per-platform overrides (`isActive`, `overrideCaption`, `overrideHashtags`, `platformSpecificSettings`). |
| `DELETE` | `/api/v1/users/me` | Soft-delete the user (status → `deactivated`). Returns `204`. |

**Validation Rules (Examples)**
- `timezone` must be a valid IANA string (e.g., `America/New_York`).
- `displayName` capped at 100 characters.
- `postingFrequency.perDay` must be ≤ the count of `activeDays × timeSlots`.
- `defaultCaptionTemplate` max 2,200 characters; `defaultHashtags` max 30 tags, 30 characters each.
- `targetPlatforms` entries must correspond to existing, active records in `platform_account_configs` for that user.

### Internal Service API

| Method | Route | Consumer | Description |
|--------|-------|----------|-------------|
| `POST` | `/internal/users/provision` | `auth_service` | Idempotent user creation after initial identity signup. Body: `{ authUserId, email }`. |
| `POST` | `/internal/users/:userId/link-platform` | `auth_service` | Upsert a newly OAuth-linked social account into `platform_account_configs`. |
| `DELETE` | `/internal/users/:userId/link-platform/:platformAccountId` | `auth_service` | Mark a linked account inactive upon OAuth revocation or token expiry. |
| `GET` | `/internal/users/:userId/posting-config` | `scheduler_service` | Return a denormalized snapshot of `user_settings` + active `platform_account_configs`. Used by Agenda.js job generators. |
| `GET` | `/internal/users/:userId/notification-preferences` | `notification_service` | Return `timezone`, `emailEnabled`, and `pushEnabled` for localized alert rendering. |

**Contract Notes**
- Internal endpoints require mTLS or a static `X-Internal-Api-Key` header; they are not reachable through the public API Gateway.
- `GET /internal/users/:userId/posting-config` supports an optional `?version=` query param. If the supplied version matches the current `settingsVersion`, the service returns `304 Not Modified` to reduce serialization overhead.

---

## Data Model

### Collections and Schema

`user_service` owns three primary MongoDB collections.

#### 1. `users` (Profile Core)

```json
{
  "_id": "ObjectId",
  "authUserId": "String  // unique, mapped to auth_service identity",
  "email": "String      // sparse unique; cached for display only",
  "displayName": "String",
  "timezone": "String   // default 'UTC'",
  "locale": "String     // default 'en-US'",
  "avatarUrl": "String",
  "accountStatus": "String  // enum: ['active', 'deactivated', 'suspended']",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

#### 2. `user_settings` (Posting Preferences)

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId  // ref users, unique",
  "settingsVersion": "Number  // incremented on every mutation",
  "targetPlatforms": ["String"],
  "postingFrequency": {
    "perDay": "Number",
    "activeDays": ["Number  // 0=Sunday, 6=Saturday"],
    "timeSlots": [
      { "hour": "Number", "minute": "Number" }
    ]
  },
  "mediaTypePreference": "String  // enum: ['photo', 'video', 'mixed', 'reel']",
  "defaultCaptionTemplate": "String  // max 2200 chars",
  "defaultHashtags": ["String  // max 30 items"],
  "publishingTimezone": "String",
  "allowDuplicatePosts": "Boolean",
  "maxPostsPerDay": "Number",
  "updatedAt": "Date"
}
```

#### 3. `platform_account_configs` (Per-Platform Overrides)

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "platformAccountId": "String  // stable ID from auth_service / token_vault",
  "platform": "String  // enum: ['instagram', 'twitter', 'facebook', ...]",
  "isActive": "Boolean",
  "linkedAt": "Date",
  "platformSpecificSettings": {
    "allowStories": "Boolean",
    "allowReels": "Boolean",
    "aspectRatioPreference": "String"
  },
  "overrideCaption": "String",
  "overrideHashtags": ["String"],
  "updatedAt": "Date"
}
```

### Indexes

| Collection | Fields | Type | Purpose |
|------------|--------|------|---------|
| `users` | `authUserId` | Unique | Enforce 1:1 mapping with `auth_service`. |
| `users` | `email` | Sparse Unique | Fast profile lookups; excludes nulls. |
| `user_settings` | `userId` | Unique | One settings document per user. |
| `platform_account_configs` | `{ userId: 1, platformAccountId: 1 }` | Unique | Prevent duplicate platform links per user. |
| `platform_account_configs` | `platformAccountId` | Single | Reverse lookup by OAuth account ID. |
| `platform_account_configs` | `{ userId: 1, isActive: 1 }` | Compound | Efficient scheduler queries for active accounts. |

---

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Duplicate auth provisioning** | `auth_service` retries user creation after a timeout, risking duplicate `users` records. | Unique index on `authUserId`; endpoint returns `200 OK` on idempotent replay and `409` only if the request body conflicts with an existing record. |
| **Partial multi-collection update** | A `PUT /settings` update that touches both `user_settings` and `platform_account_configs` could leave data inconsistent if the second write fails. | Wrap multi-collection writes in a MongoDB multi-document ACID transaction. |
| **Orphaned platform configs after OAuth revocation** | Network partition prevents `auth_service` from calling the `DELETE /link-platform` webhook. | A background reconciliation job (running every 5 minutes) queries `auth_service` for active OAuth grants and disables any local `platform_account_configs` that no longer appear in the authoritative list. |
| **Scheduler reads mid-mutation** | `scheduler_service` fetches posting config while the user is in the middle of updating settings, yielding a half-applied job definition. | Leverage MongoDB transaction snapshot isolation for the internal read endpoint; `scheduler_service` reads from the committed snapshot only. |
| **Invalid timezone / cron expressions** | User supplies a non-existent timezone (e.g., `Mars/Phobos`). Downstream Agenda.js jobs are created with invalid scheduling metadata. | Strict IANA timezone validation at the API layer using a library such as `moment-timezone` or `date-fns-tz`; reject with `400` and an explicit error code `INVALID_TIMEZONE`. |
| **Soft-delete propagation lag** | User deactivates account, but in-flight `scheduler_service` polls still see an `active` record for a few seconds. | Use a `deletedAt` tombstone field rather than a simple enum flip; the internal config endpoint filters `deletedAt: null`. Scheduler buffers config for a maximum of 30 seconds, bounding the propagation window. |

---

## Scaling Considerations

- **Read-Optimized Config Snapshots**  
  `scheduler_service` requires frequent, repeated reads of user posting rules. Rather than re-joining collections on every Agenda.js job tick, cache the denormalized output of `GET /internal/users/:userId/posting-config` in Redis with a 60-second TTL. Invalidate the cache key (`user:config:{userId}`) on any `user_settings` or `platform_account_configs` mutation.

- **Database Read Preferences**  
  Route all external `GET` requests and internal scheduler reads to MongoDB secondaries. Restrict writes and transactional reads to the primary node. This separates the write-heavy profile-update workload from the read-heavy automation planning workload.

- **Sharded User Data**  
  Shard the `users` collection by hashed `authUserId` to avoid hot-spotting on sequential `ObjectId` inserts. Co-locate `user_settings` and `platform_account_configs` on the same shard using `userId` as the shard key to keep localized queries single-shard.

- **Cursor-Based Bulk Export for Scheduler**  
  When `scheduler_service` rehydrates its daily job queue, requesting one user at a time is inefficient. Expose a paginated bulk endpoint `/internal/users/posting-configs?limit=500&cursor=` that returns batches of denormalized configs, ordered by `userId`. This prevents connection pool exhaustion during peak scheduling windows.

- **Connection Pool Management**  
  The MongoDB Node.js driver connection pool must be sized to the Express worker count. In containerized deployments, fix the pool size (e.g., `minPoolSize: 5`, `maxPoolSize: 20`) and scale horizontally by adding pods rather than increasing thread-per-instance concurrency.

- **Settings Version Throttling**  
  Rapid client toggling (e.g., a user spamming the save button) can trigger excessive scheduler re-evaluations. Debounce the `PUT /api/v1/users/me/settings` endpoint at the API Gateway layer and enforce a minimum 5-second write cooldown per `userId` inside `user_service` using an in-memory LRU or Redis flag.

- **Archival of Deactivated Accounts**  
  After 90 days in `deactivated` status, move `users`, `user_settings`, and `platform_account_configs` documents to a cold archive collection (or S3/Parquet) and retain only a lightweight lookup stub in MongoDB. This keeps indexes compact and query latencies predictable as the user base grows.