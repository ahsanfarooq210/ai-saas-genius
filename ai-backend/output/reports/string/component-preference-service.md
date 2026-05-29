# Preference Service

## Responsibilities

- Persist per-user posting configurations including target platforms, media type rules, caption templates, hashtag sets, publishing schedules, and account-specific overrides.
- Validate incoming preference mutations for schema correctness, platform compatibility, and schedule consistency before writing to MongoDB.
- Serve preference payloads to internal consumers—principally the `contentBuilder` during post assembly and the API Gateway during user-facing CRUD operations.
- Enforce business constraints such as maximum hashtag counts per set, allowed platform enums (`instagram`, `facebook`, `twitter`, `linkedin`), and valid IANA timezone strings in schedules.
- Maintain an `isActive` flag so that downstream job scheduling can distinguish between draft and live configurations without deleting records.

## APIs / Interfaces

### External HTTP API (mounted via API Gateway)

- `GET /api/v1/preferences`
  - Returns the authenticated user’s preference documents.
  - Response: `200 OK` with array of preference objects.

- `POST /api/v1/preferences`
  - Creates a new preference set.
  - Request body: `{ targetPlatforms, mediaType, postingSchedule, captionTemplate, hashtagSets, accountOverrides? }`.
  - Response: `201 Created` with `Location` header pointing to the new resource.

- `PUT /api/v1/preferences/:preferenceId`
  - Full or partial update; immutable fields (`userId`, `createdAt`) are stripped by the controller.
  - Validates that `:preferenceId` belongs to the authenticated user.
  - Response: `200 OK` with updated document.

- `DELETE /api/v1/preferences/:preferenceId`
  - Hard-deletes the document only if no pending Agenda.js jobs reference it; otherwise returns `409 Conflict`.
  - Response: `204 No Content` on success.

### Internal Service Interface (Node.js module exports)

- `async getPreferencesByUser(userId: ObjectId): Promise<PreferenceDoc[]>`
  - Used by the API Gateway GET handler and by internal orchestrators.

- `async getActivePreferencesByUser(userId: ObjectId): Promise<PreferenceDoc[]>`
  - Used by the `contentBuilder` to retrieve live rules when assembling posts.

- `async createPreference(userId: ObjectId, payload: CreatePreferenceDTO): Promise<PreferenceDoc>`
  - Applies default values (e.g., `isActive: true`) and runs platform validation.

- `async updatePreference(preferenceId: ObjectId, userId: ObjectId, delta: Partial<PreferenceDoc>): Promise<PreferenceDoc>`
  - Performs atomic `$set` updates in MongoDB and returns the modified document.

- `async deletePreference(preferenceId: ObjectId, userId: ObjectId): Promise<void>`
  - Checks for foreign references before issuing a delete.

## Data Owned

MongoDB collection: `preferences`

- `userId` (`ObjectId`, indexed)
  - References the owning user; enforces tenancy for every query.

- `targetPlatforms` (`[String]`, required)
  - Supported values: `instagram`, `facebook`, `twitter`, `linkedin`.

- `mediaType` (`String`, enum: `photo`, `video`, `mixed`)

- `postingSchedule` (embedded object)
  - `frequency`: enum `daily`, `weekly`, `custom`
  - `timeSlots`: array of `{ hour: Number, minute: Number }` in 24-hour format
  - `timezone`: IANA string (e.g., `America/New_York`)
  - `daysOfWeek`: array of integers (0–6), used when `frequency` is `weekly`

- `captionTemplate` (`String`, max 2200 characters)
  - May include substitution tokens (e.g., `{{date}}`) resolved later by the `contentBuilder`.

- `hashtagSets` (`[[String]]`)
  - Outer array represents alternate sets; inner array holds individual hashtags. Maximum 30 tags per inner array to comply with Instagram limits.

- `accountOverrides` (`Map<String, OverrideConfig>`)
  - Keyed by `accountId` from the `accountService`; overrides `captionTemplate`, `hashtagSets`, or `timeSlots` for that specific linked account.

- `isActive` (`Boolean`, default `true`)
  - Determines whether the `jobScheduler` should include this preference when generating future jobs.

- `createdAt`, `updatedAt` (`Date`)
  - Managed via Mongoose timestamps or manual `$currentDate`.

## Failure Modes

- **Validation rejection on write**
  - Occurs when `postingSchedule.timeSlots` contain out-of-range hours/minutes or unsupported `targetPlatforms`. The service returns `400 Bad Request` with a field-level error map.

- **Race condition on concurrent updates**
  - Two simultaneous `PUT` requests for the same `:preferenceId` can overwrite each other. Mitigated by issuing atomic `$set` updates only to provided fields rather than full-document replacement.

- **Orphaned preference documents**
  - If a user is deleted in the `authService`, the `preferences` collection may retain documents with dangling `userId` references. Mitigated by a TTL cleanup worker or a transactional outbox pattern that consumes user-deletion events.

- **Timezone drift in scheduling**
  - Omitting the `timezone` field or storing only local offsets causes jobs to shift during daylight-saving transitions. The schema enforces a required IANA `timezone` string.

- **Hashtag set explosion**
  - Unbounded growth of `hashtagSets` could approach MongoDB’s 16 MB document limit. Enforced application-level limits: maximum 10 sets per document, 30 hashtags per set.

- **MongoDB unavailability**
  - Lost connections surface as rejected Promises in the Express async handlers. The service does not maintain a fallback cache for writes; it returns `503 Service Unavailable` until the replica set recovers.

## Scaling Considerations

- **Read-heavy access pattern**
  - The `contentBuilder` reads active preferences for every post assembly, and the `jobScheduler` may scan them when rebuilding job queues. A compound index on `{ userId: 1, isActive: 1 }` is required; optionally add `{ targetPlatforms: 1 }` if filtering by platform becomes common.

- **Caching layer**
  - Preference data changes infrequently relative to reads. Introduce a Redis cache keyed by `userId` with a short TTL (e.g., 300 seconds) to reduce MongoDB load. Cache invalidation is triggered on successful `updatePreference` or `deletePreference` calls.

- **Horizontal scaling**
  - The service is stateless; deploy multiple Express instances behind the API Gateway load balancer. MongoDB driver connection pools should be tuned (`maxPoolSize` proportional to instance count × worker threads) to avoid socket exhaustion.

- **Write debouncing for schedule changes**
  - Rapid toggles of `isActive` or `timeSlots` by a user could flood the `jobScheduler` with recalculation requests. Consider rate-limiting preference updates per user (e.g., 10 updates per minute) or publishing domain events to an async consumer rather than synchronously notifying the job engine.

- **Sharding**
  - If the user base exceeds single-replica performance limits, shard the `preferences` collection by `userId` using MongoDB’s hashed sharding strategy to distribute documents evenly and keep related preferences on a single shard.