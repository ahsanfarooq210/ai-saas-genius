# Content Builder

## Responsibilities

The Content Builder assembles raw media assets, user-defined captions, hashtags, and metadata into platform-specific post payloads that are ready for external publication. Its specific duties include:

- **Payload Assembly**: Fetching media references from `mediaStorage` and preference documents from `preferenceService` to construct a complete post object per target platform (e.g., Instagram, Twitter/X, TikTok).
- **Platform Normalization**: Adapting generic user content to platform-specific constraints, such as character limits, hashtag placement, aspect-ratio requirements, and accepted MIME types.
- **Media Retrieval & Streaming**: Resolving signed URLs or binary streams from `mediaStorage` for each pending post without persisting original assets locally.
- **Validation**: Verifying that assembled payloads meet minimum completeness rules (required media present, non-empty caption where mandated, valid scheduling metadata) before returning them to the caller.
- **Transient Transformation**: Optionally resizing images or re-muxing video into platform-preferred containers when `mediaStorage` holds canonical files in a generic format.

## APIs and Interfaces

Content Builder is an internal service consumed by the `publisherService`. It does not expose public HTTP endpoints.

### Core Service Interface

```typescript
interface ContentBuilder {
  /**
   * Retrieves media and preferences, then returns platform-specific payloads.
   * Called by publisherService immediately before external API submission.
   */
  assemble(
    userId: string,
    mediaAssetIds: string[],
    preferenceSnapshotId: string,
    targets: SocialPlatform[]
  ): Promise<PlatformPostPayload[]>;

  /**
   * Streams a normalized media asset suitable for the target platform.
   * May apply on-the-fly transcoding or format checks.
   */
  getNormalizedMediaStream(
    assetId: string,
    target: SocialPlatform
  ): Promise<ReadableStream>;

  /**
   * Validates that a payload satisfies platform constraints.
   */
  validate(
    payload: PlatformPostPayload,
    target: SocialPlatform
  ): ValidationResult;
}
```

### Inputs and Dependencies

- **`preferenceService`**: Fetches the user’s posting preferences (caption templates, hashtag sets, frequency rules, and account-specific overrides) by `preferenceSnapshotId`.
- **`mediaStorage`**: Resolves media asset binaries or pre-signed URLs using `assetId`.
- **Caller**: `publisherService` invokes `assemble()` inside an Agenda.js job handler.

### Output Contract

Returns an array of `PlatformPostPayload` objects, one per target platform, each containing:
- `platform`: Target identifier (e.g., `instagram`, `twitter`).
- `mediaStream` or `mediaUrl`: Reference to the normalized asset.
- `caption`: Final rendered text with merged hashtags.
- `metadata`: Scheduling context, privacy settings, and cross-posting identifiers.

## Data Ownership

Content Builder is a stateless processing component and **does not own persistent database collections**. It operates exclusively on transient data during job execution:

- **In-memory payloads**: Assembled post structures exist only for the duration of the `assemble()` call.
- **Temporary transformation artifacts**: When normalization requires transcoding or resizing, short-lived files may be written to an ephemeral local temp directory or streamed through memory. These are deleted immediately after the job step completes.
- **No source-of-truth data**: Original media remains in `mediaStorage`; captions, hashtags, and rules remain in `preferenceService`.

## Failure Modes

| Failure | Cause | Impact | Mitigation |
|---|---|---|---|
| **Missing Media** | User deletes an asset from `mediaStorage` after a job is scheduled but before `assemble()` runs. | `publisherService` receives an incomplete payload and cannot publish. | Validate asset existence early; fail the job with a retry-exempt error so Agenda.js marks it dead. |
| **Stale Preferences** | User updates preferences between job creation and execution; the snapshot ID references outdated rules. | Post goes out with old caption or wrong hashtags. | Pass an immutable preference snapshot ID to `assemble()` rather than live-querying by user ID, ensuring consistency. |
| **Platform Constraint Violation** | Caption exceeds Twitter’s character limit or video duration exceeds Instagram Reels constraints. | External API rejects the post at publish time. | Enforce `validate()` inside Content Builder and surface hard failures before handing off to `publisherService`. |
| **Media Format Incompatibility** | `mediaStorage` holds a MOV/HEVC file but the target platform requires MP4/H.264. | Publisher cannot upload the binary. | Detect MIME types in `getNormalizedMediaStream()` and trigger format normalization; return a clear error if transcoding is unavailable. |
| **Memory/CPU Exhaustion** | Loading a large video into memory for re-muxing blocks the Node.js event loop or exceeds container limits. | Job handler crashes or times out, stalling the Agenda.js worker. | Stream media instead of buffering; offload heavy transcoding to external worker threads or dedicated FFmpeg microservices. |
| **Temporary Disk Saturation** | Ephemeral local storage fills with transformation artifacts under high concurrency. | Subsequent assembly jobs fail with `ENOSPC`. | Enforce strict temp-file cleanup in `finally` blocks and size quotas per job. |

## Scaling Considerations

- **Stateless Horizontal Scaling**: Because Content Builder holds no local state, instances can scale behind `publisherService` workers. Multiple Agenda.js worker pods can invoke `assemble()` concurrently without coordination.
- **Event-Loop Blocking**: Node.js is single-threaded. Image resizing and video transcoding must not run on the main thread. CPU-bound work should be delegated to Node.js Worker Threads, separate containerized workers, or serverless functions (e.g., AWS Lambda for FFmpeg).
- **Streaming Architecture**: When possible, pipe the output of `getNormalizedMediaStream()` directly to the upstream platform API rather than writing normalized files to disk. If disk is required, use high-speed ephemeral volumes and guarantee cleanup.
- **Preference Caching**: User preferences are read-heavy and change infrequently. A short-lived in-memory LRU cache (TTL 60–120 seconds) in front of `preferenceService` reduces redundant MongoDB lookups during burst publishing windows.
- **Resource Quotas**: Container definitions should reserve appropriate RAM and CPU for the worst-case scenario (e.g., concurrent 4K video normalization). If quotas are exceeded, the assembly step should fail fast and push the job to a slower, capacity-rich worker queue rather than crashing the process.

## Related Diagrams

- `diagrams/string/iter1_component-content-builder.mmd`