# Iterative architecture revisions

The revision API applies a follow-up instruction to the latest successful architecture for a `thread_id`. It is the architecture equivalent of editing an existing working tree: the previous architecture is supplied to the lead architect, unaffected decisions are preserved, and all diagrams and documents are regenerated from the revised result.

## Run, revise, and resume

| Operation | Purpose | Graph input |
|-----------|---------|-------------|
| `POST /api/v1/swarm/run` | Create revision 1 from a new requirement | Empty swarm state |
| `POST /api/v1/swarm/revise` | Apply a new instruction to the latest successful result | Latest persisted result plus revision reset fields |
| `POST /api/v1/swarm/resume` | Continue an interrupted checkpoint without adding an instruction | `None` |

Do not use `resume` for a user-requested design change. It supplies no new prompt.

## Submit a follow-up

Blocking request:

```http
POST /api/v1/swarm/revise
Content-Type: application/json

{
  "thread_id": "url-shortener-123",
  "instruction": "Replace the local cache with Redis and add a failover strategy."
}
```

Progress streaming uses the same body with:

```text
POST /api/v1/swarm/revise/stream
```

The stream contains progress only. After `event: done`, fetch the promoted result:

```text
GET /api/v1/swarm/sessions/url-shortener-123
```

## Revision execution

The service reserves the next revision number, marks the session and revision `running`, and starts from the latest successful app-table projection. It keeps the original `task_requirement`, sets `revision_instruction`, resets supervisor/reviewer fields, and sets `revision_pending=true`.

`revision_pending` is the supervisor's highest-priority gate, so an existing completed architecture cannot skip directly to `END` or documentation. The architect receives the original requirement, current architecture JSON and Mermaid, and the new instruction. After the complete revised architecture is returned, diagrams and Markdown docs are regenerated and reviewers run through the existing pipeline.

Only a successful full graph result is promoted to `sessions`, `session_artifacts`, and `debate_logs`. A failed revision is recorded as failed while the preceding successful architecture and artifact rows remain current.

## History APIs

```text
GET /api/v1/swarm/sessions/{thread_id}/revisions
GET /api/v1/swarm/sessions/{thread_id}/revisions/{revision_number}
```

The list endpoint returns revision metadata and `current_revision`. The detail endpoint returns the stored final state for that revision. Historical artifact URLs remain valid because Cloudinary keys contain both the thread and revision number.

Only one run or revision may mutate a thread at a time. A revision for an unknown thread returns `404`; a revision while the session is `running` returns `409`.

## Persistence

- `sessions.current_revision` identifies the latest successful version.
- `swarm_revisions` records the instruction, status, timestamps, and complete successful result state.
- `session_artifacts` and `debate_logs` remain the latest-result projection.
- Existing completed sessions are assigned revision 1 by migration; their complete baseline snapshot is materialized lazily when revision history or the first follow-up is requested.
- Artifact keys use `swarm-artifacts/{thread_id}/revisions/{revision_number}/...`.

