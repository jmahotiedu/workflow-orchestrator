# Architecture and Tradeoffs

## System Components

1. Control Plane
- Accepts workflow definitions and validates DAG structure.
- Creates workflow runs and expands task graph into persisted tasks.
- Schedules cron-based runs.
- Maintains admission controls and cancellation.

2. Queue Layer
- Redis Streams with consumer groups for worker distribution.
- Delayed retries in a sorted set, pumped back into stream.

3. Worker Fleet
- Claims tasks from stream, takes DB lease, executes task.
- Sends heartbeat and renews lease.
- Records attempts and transitions task outcomes.

4. Persistence
- Postgres stores durable workflow/run/task state and attempt history.
- Dead-letter table stores terminal failures and payload context.

5. Observability
- Prometheus metrics from control plane and worker.
- Grafana and Loki included in local stack.

## Tradeoffs

## At-Least-Once vs Exactly-Once
- Chosen: at-least-once.
- Reason: practical reliability with explicit idempotency expectations for tasks.
- Impact: task handlers should be safe under replay.

## Redis Streams + Postgres State
- Chosen: Redis for dispatch, Postgres as source-of-truth state.
- Reason: fast queue operations with durable domain state.
- Impact: requires careful reconciliation between stream and DB status.

## DB-Lease Recovery
- Chosen: lease timeout + reaper.
- Reason: simple crash recovery and clear failure mode.
- Impact: leases must be tuned to execution duration and heartbeat cadence.

## Failure Model Summary

- Worker crash during task:
  - lease expires -> reaper moves task to retry/dead-letter path.
- Redis hiccup:
  - delayed tasks remain persisted in DB as pending and are eventually re-queued.
- Duplicate trigger requests:
  - idempotency key unique constraint dedupes run creation.
