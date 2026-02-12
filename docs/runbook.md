# Operations Runbook

## Service Startup

1. `docker compose up -d`
2. `npm run -w control-plane migrate`
3. `npm run -w control-plane dev`
4. `npm run -w worker dev`
5. `npm run -w ui dev`

## Health Checks

- API health: `GET /api/health`
- Metrics: `GET /api/metrics`
- Worker metrics: `GET :8081/metrics`

## Common Incidents

## Stuck Running Tasks

Symptoms:
- Tasks remain `running` without heartbeat progression.

Actions:
1. Confirm worker availability.
2. Verify `lease_expires_at` is advancing.
3. If leases are stale, reaper should move tasks to retry/dead-letter.
4. Inspect `dead_letters` and `task_attempts` for root cause.

## Queue Backlog Growth

Symptoms:
- Delayed queue and stream depth trend upward.

Actions:
1. Scale worker replicas.
2. Validate DB latency and worker heartbeat logs.
3. Check for task type with elevated failure/retry rate.
4. Temporarily lower trigger throughput.

## High Failure Rate

Symptoms:
- Rising `task_status_total{status="failed"}` and dead-letter insertions.

Actions:
1. Inspect most recent attempt errors by node id.
2. Evaluate whether input payloads changed.
3. Disable affected workflows or cancel active runs.
4. Patch task handler and redeploy.

## Rollback

1. Stop control-plane + workers.
2. Deploy previous image tags.
3. Bring up control-plane first, then workers.
4. Re-verify run/task progression.

## On-call Notes

- Keep `LEASE_MS` at least 4x heartbeat interval.
- Use idempotency keys for all external trigger integrations.
- Treat task handlers as replayable by design.
