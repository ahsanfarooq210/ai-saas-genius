# User Service

## Responsibilities

- **User Profile Management**: Maintains core identity records (email, display name, timezone, locale, plan tier, and account status). Enforces uniqueness constraints and data retention policies.
- **Connected Account Registry**: Stores metadata for linked social media accounts—platform type, native platform account ID, handle, account name, and linkage state. It does **not** store OAuth tokens or secrets; those remain in the `Auth_Service`. It maintains a foreign reference (`authServiceRef`) to correlate each connected account with its credentials.
- **Posting Preferences Configuration**: Owns the scheduling and content policy settings that drive Agenda.js job generation. This includes global defaults (media types, posting frequency, caption templates, hashtag groups, publishing time windows) and per-account/platform overrides.
- **User Context Provider**: Serves as the authoritative source of user context for downstream services. `Job_Service` and `Content_Service` call the User Service to resolve which accounts are active, what the current publishing rules are, and what timezone to use when calculating next-run times.
- **Account Lifecycle Coordination**: Receives status callbacks from `Auth_Service` and `Publish_Service` when tokens are refreshed, revoked, or API permissions change, updating the connection state of the affected account record.
- **Notification Triggers**: Emits lightweight event payloads to `Notification_Service` for account lifecycle events (e.g., social account disconnected, preference validation warnings, plan limit approached).

## APIs / Interfaces

### Public REST API (via API Gateway)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/users/:userId` | Retrieve full user profile. |
| `PATCH` | `/v1/users/:userId` | Update mutable profile fields (display name, timezone, locale). |
| `GET` | `/v1/users/:userId/accounts` | List all connected social accounts with status and metadata. |
| `POST` | `/v1/users/:userId/accounts` | Initiate linkage of a new social account. Stores pending metadata and coordinates with `Auth_Service` for OAuth token association. |
| `DELETE` | `/v1/users/:userId/accounts/:accountId` | Disconnect a social account. Clears the local metadata record; `Auth_Service` handles token revocation separately. |
| `GET` | `/v1/users/:userId/preferences` | Retrieve posting preferences (global defaults and platform overrides). |
| `PUT` | `/v1/users/:userId/preferences` | Replace the entire posting preferences document. Subject to strict schema validation. |
| `PATCH` | `/v1/users/:userId/preferences` | Partial update to specific preference fields (e.g., update only `globalDefaults.timeWindows`). |

### Internal Service API

| Method | Endpoint | Consumers | Description |
|--------|----------|-----------|-------------|
| `GET` | `/internal/v1/users/:userId/context` | `Job_Service`, `Content_Service` | Returns an aggregated snapshot of the user’s profile, active connected accounts, and resolved posting preferences. Used to build Agenda.js job definitions. |
| `PATCH` | `/internal/v1/users/:userId/accounts/:accountId/status` | `Auth_Service`, `Publish_Service` | Updates the `connectionStatus` and `lastVerifiedAt` fields for an account (e.g., mark as `revoked` or `active`). |
| `GET` | `/internal/v1/users/:userId/accounts/:accountId/health` | `Job_Service` | Lazy health check that returns the stored status without blocking on external calls. |

### Interface Contracts

```json
// GET /internal/v1/users/:userId/context — Response payload
{
  "userId": "507f1f77bcf86cd799439011",
  "timezone": "America/New_York",
  "planTier": "pro",
  "isActive": true,
  "accounts": [
    {
      "accountId": "507f1f77bcf86cd799439012",
      "platform": "instagram",
      "platformAccountId": "17841405792687223",
      "accountHandle": "@example",
      "connectionStatus": "active",
      "authServiceRef": "tok_inst_abc123"
    }
  ],
  "preferences": {
    "globalDefaults": {
      "mediaTypes": ["photo", "video"],
      "frequency": { "count": 3, "period": "day" },
      "timeWindows": [
        { "start": "09:00", "end": "11:00", "days": [1, 2, 3, 4, 5] },
        { "start": "18:00", "end": "20:00", "days": [1, 3, 5] }
      ],
      "defaultCaptionTemplate": "Check out our latest update!",
      "defaultHashtagGroups": ["#brand", "#daily"]
    },
    "platformOverrides": [
      {
        "accountId": "507f1f77bcf86cd799439012",
        "isActive": true,
        "mediaTypes": ["photo"],
        "timeWindows": [{ "start": "12:00", "end": "13:00", "days": [6] }]
      }
    ]
  }
}
```

## Data Owned

All data is persisted in **MongoDB** under the application primary database.

### `users` Collection
Core identity and billing context.
- `_id: ObjectId`
- `email: String` (unique, sparse index)
- `displayName: String`
- `timezone: String` (IANA format, e.g., `Europe/London`)
- `locale: String` (BCP 47, e.g., `en-US`)
- `planTier: String` (e.g., `free`, `starter`, `pro`)
- `isActive: Boolean`
- `createdAt: Date`
- `updatedAt: Date`

### `connected_accounts` Collection
Social platform linkage metadata. References `Auth_Service` tokens by opaque ID.
- `_id: ObjectId`
- `userId: ObjectId` (indexed)
- `platform: String` (`instagram`, `twitter`, `facebook`, `linkedin`, `tiktok`)
- `platformAccountId: String` (platform-native user/page ID)
- `accountHandle: String`
- `accountName: String`
- `authServiceRef: String` (foreign key to token record in `Auth_Service`)
- `connectionStatus: String` (`active`, `refreshing`, `error`, `revoked`)
- `lastVerifiedAt: Date`
- `createdAt: Date`
- `updatedAt: Date`
- **Indexes**: `{ userId: 1, platform: 1 }`, `{ authServiceRef: 1 }`

### `posting_preferences` Collection
Scheduling rules and content defaults that feed the Agenda.js queue.
- `_id: ObjectId`
- `userId: ObjectId` (unique, indexed)
- `globalDefaults: Object`
  - `mediaTypes: [String]`
  - `frequency: { count: Number, period: String }`
  - `timeWindows: [Object]`
  - `defaultCaptionTemplate: String`
  - `defaultHashtagGroups: [String]`
- `platformOverrides: [Object]` (max 50 entries enforced at app layer)
  - `accountId: ObjectId`
  - `isActive: Boolean`
  - `mediaTypes: [String]`
  - `captionTemplate: String`
  - `hashtagGroups: [String]`
  - `timeWindows: [Object]`
- `version: Number` (optimistic locking field)
- `updatedAt: Date`

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **MongoDB primary unavailable** | All profile, account, and preference reads/writes fail. | Fail fast with HTTP `503 Service Unavailable`. Use MongoDB driver-retry settings only for transient network blips, not indefinite queuing. |
| **Stale account status** | User sees an account as `active`, but the underlying OAuth token in `Auth_Service` is expired or revoked, causing downstream publish failures. | Lazy reconciliation: `Publish_Service` propagates permanent auth failures back via `/internal/v1/users/.../status`. Additionally, schedule a daily background sweep that queries `Auth_Service` for tokens nearing expiration and updates `connectionStatus` proactively. |
| **Preference document bloat** | Unbounded `platformOverrides` arrays approach the 16 MB MongoDB document limit or slow deserialization. | Enforce a hard application limit of 50 overrides. Validate array length before `PUT`/`PATCH`. |
| **Concurrent preference updates** | Two simultaneous `PATCH` requests from the client cause lost updates (last-write-wins). | Implement optimistic concurrency control. Require `If-Match` header matching the current `version`. Reject with `409 Conflict` if the version has changed. |
| **Invalid scheduling windows** | Malformed time strings or overlapping windows produce unscheduleable Agenda.js jobs. | Strict schema validation using a library such as Zod or Joi before persistence. Reject with `422 Unprocessable Entity` and detailed field errors. |
| **Notification_Service timeout** | Account disconnection alerts are dropped. | Treat notification calls as fire-and-forget with a 500 ms timeout. Log failures locally; a periodic reconciliation job in `Notification_Service` can backfill from the `users` and `connected_accounts` collections if needed. |
| **Orphaned connected account records** | A user is hard-deleted, but `connected_accounts` and `posting_preferences` documents remain. | Wrap user deletion in a MongoDB transaction that deletes all three collections’ documents by `userId`, or implement a cascading cleanup worker. |

## Scaling Considerations

- **Stateless horizontal scaling**: The service is fully stateless. Scale Node.js/Express instances behind a load balancer without sticky sessions.
- **Read replica offloading**: `GET /internal/v1/users/:userId/context` is invoked heavily by `Job_Service` when evaluating job queues. Route these internal reads to MongoDB secondary replicas to reduce primary-node pressure.
- **Indexing strategy**: Maintain the following indexes to prevent collection scans:
  - `users`: `{ email: 1 }`
  - `connected_accounts`: `{ userId: 1, platform: 1 }`, `{ connectionStatus: 1 }`
  - `posting_preferences`: `{ userId: 1 }`
- **Database connection pooling**: Tune the MongoDB Node.js driver `maxPoolSize` (recommended baseline 20–50 per instance) based on container replica count to avoid connection exhaustion.
- **Avoid write amplification**: Preference updates should not synchronously trigger Agenda.js job re-computation. `User_Service` persists the change; `Job_Service` independently polls for preference version changes or relies on lightweight events to rebuild its schedule.
- **Sharding boundary**: If the user base exceeds single-node write capacity, shard `connected_accounts` and `posting_preferences` by `userId`. The `users` collection should remain a manageable size and can stay unsharded or use a hashed shard key on `_id`.

## Related Diagrams

No paired Mermaid diagram was specified for this component.