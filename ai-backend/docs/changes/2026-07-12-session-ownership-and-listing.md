# User-scoped swarm sessions

## Change

Added authenticated ownership to app-managed swarm sessions and introduced
`GET /api/v1/swarm/sessions` for newest-first dashboard summaries.

Migration `005_add_session_ownership.py` adds `sessions.user_id` as a foreign
key to `users.id` with `ON DELETE CASCADE`. The column is nullable only for
pre-migration rows whose owner cannot be inferred safely. Application-created
sessions require a user id, and legacy unowned rows are hidden from
authenticated APIs.

The `(user_id, created_at)` index supports the collection query. Child tables
continue to reference `sessions.thread_id`; they do not duplicate ownership.

## Authorization behavior

The authenticated user id is passed from FastAPI into the graph service for
run, resume, revise, checkpoint, session, and revision operations. Missing,
legacy-unowned, and cross-user thread ids all return `404`. This prevents
thread-id enumeration while keeping `sessions.user_id` as the single app-table
authorization boundary.

## Verification

Coverage includes owner-only listing, pagination bounds, owner persistence,
foreign-thread reads and mutations, missing-owner rejection, migration-chain
validation, and the composite index shape.

## Rollback

Stop code that depends on session ownership or the collection endpoint before
downgrading. Downgrading from revision `005_add_session_ownership` removes the
owner index, foreign key, and `user_id` column. LangGraph checkpoint rows and
artifact-store objects are unaffected by that database downgrade.
