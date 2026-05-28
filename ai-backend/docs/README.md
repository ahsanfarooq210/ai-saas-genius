# Documentation

This `docs/` folder is the canonical home for human-readable project documentation.

It is organized so both humans and coding agents can answer two different questions quickly:

1. What is live in the code right now?
2. What is the intended target architecture and how do we plan to get there?

## Start Here

- [current/project-state.md](current/project-state.md): best entry point for the live system today
- [changes/2026-05-28-diagram-generation-foundation.md](changes/2026-05-28-diagram-generation-foundation.md): recent critical code changes and what they mean
- [architecture/plan.md](architecture/plan.md): target architecture, not guaranteed to be fully implemented

## Folder Guide

| Path | Purpose |
|------|---------|
| [current/](current/) | Live system documentation. Use this when you need to understand the code that is actually wired today. |
| [changes/](changes/) | Change logs for important architectural or behavioral changes. Use this to understand why the code changed and what was introduced. |
| [architecture/](architecture/) | Long-term target architecture and design constraints. Treat this as roadmap material unless the code matches it. |
| [learning/](learning/) | Progressive build plans and educational implementation guidance. |
| [flows/](flows/) | Phase-specific flow diagrams. [phase-6-flow.md](flows/phase-6-flow.md) (reducers), [phase-7-flow.md](flows/phase-7-flow.md) (parallel diagram workers). |

## Documentation Rules

- Keep `current/` aligned with the live code.
- Keep `changes/` focused on important decisions, new behavior, and migration notes.
- Keep `architecture/` focused on the target design, not the current implementation snapshot.
- If a route, graph edge, state field, or feature changes in code, update the relevant file in `current/` or `changes/`.
- When code and docs disagree, code wins until docs are corrected.
