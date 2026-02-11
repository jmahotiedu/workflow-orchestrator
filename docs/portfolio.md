# Portfolio Notes: Workflow Orchestrator

## What I Built

I built a distributed workflow orchestration system with a TypeScript control plane, Redis Streams dispatch, Postgres-backed run/task state, and a worker fleet that uses lease + heartbeat semantics for safe recovery.

Core capabilities:

- Workflow authoring with DAG validation and persisted definitions.
- Triggered and cron-scheduled runs with idempotency keys.
- Worker execution with retries, exponential backoff, and dead-letter routing.
- Run cancellation and a live SSE feed for run/task updates.
- Dashboard for runs, tasks, failures, and operational inspection.
- Prometheus telemetry for API and worker behavior.

## Tradeoffs I Chose

### At-Least-Once Delivery (Not Exactly-Once)

- Why: simpler, practical reliability for most background jobs.
- Cost: handlers must be idempotent or replay-safe.

### Redis Streams + Postgres Split

- Why: low-latency queue operations plus durable source-of-truth state.
- Cost: more reconciliation logic between transient queue state and durable DB state.

### Lease-Based Recovery

- Why: deterministic crash recovery with bounded stale task windows.
- Cost: requires careful lease/heartbeat tuning by workload profile.

## Incident Story (Crash Drill)

During a controlled drill on 2026-02-12, I terminated all worker processes while runs were active. Tasks stopped heartbeating, leases expired, and the reaper pushed affected tasks back into retry/dead-letter paths. After restarting workers, the system drained pending work and reached terminal run states without stuck `running` tasks or duplicate run creation. See `docs/postmortems/2026-02-12-worker-crash-drill.md`.

## What I Would Do Next

1. Add tenant isolation and quota enforcement.
2. Add stronger alerting (SLO burn-rate alerts, queue lag alerts).
3. Introduce a plugin SDK for custom task executors.
4. Add deterministic replay/simulation mode for workflow debugging.
5. Support remote object storage for large payload attachments.

## Resume / Portfolio Site Bullets

- Distributed execution engine with retries, exponential backoff, and dead-letter handling.
- Scheduling layer with idempotent workflow triggers and run concurrency controls.
- Observability stack with metrics dashboards plus incident drill runbook/postmortem.
