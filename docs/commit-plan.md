# Milestone Commit Plan

This repository follows milestone commits with explicit dates and conventional commit subjects.

## Rules

- Conventional commit subject on line 1.
- One logical change per commit.
- Commit body contains `why`, `what`, and `verification`.
- No `Co-authored-by` trailers.

## Commit Body Template

```text
why:
- <motivation / problem>

what:
- <key changes>

verification:
- <commands run>
```

## Timeline

| Date | Milestone | Commit Subject |
| --- | --- | --- |
| 2026-01-02 | scaffold monorepo, docker-compose, Makefile | `chore(repo): scaffold monorepo and local dev stack` |
| 2026-01-05 | shared contracts, DAG/state machine | `feat(shared): add workflow contracts and DAG lifecycle model` |
| 2026-01-07 | DB migrations + store baseline | `feat(store): add initial postgres schema and baseline persistence` |
| 2026-01-09 | Redis Streams queue wiring | `feat(queue): wire redis streams producer and consumer contracts` |
| 2026-01-12 | worker executor + lease/heartbeat | `feat(worker): implement executor with lease and heartbeat loop` |
| 2026-01-14 | retry/backoff + dead-letter + recovery tests | `feat(reliability): add retry backoff, dead-letter path, and recovery tests` |
| 2026-01-16 | cron scheduler | `feat(scheduler): add cron-based run scheduler` |
| 2026-01-19 | idempotent trigger endpoint | `feat(api): add idempotent run trigger endpoint` |
| 2026-01-21 | admission controls + tests | `feat(admission): enforce run admission controls and coverage` |
| 2026-01-23 | workflow/run/task API surface | `feat(api): expose workflow run and task APIs` |
| 2026-01-26 | run cancellation + live event stream | `feat(events): add run cancellation and live sse stream` |
| 2026-01-28 | dashboard UI (runs/tasks/errors) | `feat(ui): add dashboard views for runs tasks and errors` |
| 2026-01-30 | Prometheus metrics + telemetry hooks | `feat(obs): add prometheus metrics and telemetry hooks` |
| 2026-02-02 | rate limits + auth/RBAC middleware | `feat(security): add rate limiting and rbac middleware` |
| 2026-02-04 | hardening tests + docs updates | `test(hardening): expand reliability tests and operational docs` |
| 2026-02-06 | Kubernetes manifests + CI workflow | `chore(infra): add kubernetes manifests and ci workflow` |
| 2026-02-09 | benchmark harness + results format | `feat(bench): add benchmark harness and result artifacts` |
| 2026-02-11 | architecture doc + runbook + postmortem + portfolio polish | `docs(portfolio): finalize architecture runbook postmortem and portfolio assets` |

## Tags

- `v0.1.0`: end of core orchestration + reliability milestones.
- `v0.2.0`: portfolio polish, operations docs, and benchmark artifacts.
