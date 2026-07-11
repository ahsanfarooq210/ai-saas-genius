# Iterative architecture revisions

## Change

Added dedicated blocking and streaming revision endpoints, revision-aware graph state and prompts, versioned Cloudinary paths, durable revision history, and latest-successful promotion semantics.

The migration is `004_add_swarm_revisions.py`. It creates `swarm_revisions`, adds `sessions.current_revision`, and marks existing completed sessions as revision 1. Their full revision snapshot is created lazily from the existing session, artifact, and debate-log projection.

## Failure behavior

A failed follow-up records a failed revision and marks the session status failed, but it does not replace `current_revision`, architecture fields, current artifact rows, or current debate logs. A later follow-up starts from the last successfully promoted projection.

## Rollback

Before downgrading, stop clients from calling `/swarm/revise*`. Downgrade Alembic from revision `004_add_swarm_revisions` to `003_add_session_graph_state`, then revert the revision endpoints/state fields and restore the previous artifact-store method signatures. Artifact objects already uploaded under revision-specific Cloudinary paths are not deleted by the database downgrade.

