# Postmortem: Worker Fleet Crash Drill

- Date: 2026-02-12
- Severity: SEV-2 (degraded throughput, no data loss)
- Environment: local staging

## Summary

We intentionally terminated all worker processes during active runs to validate lease-based recovery and dead-letter behavior.

Expected behavior was retry after lease expiry with at-least-once semantics. The system recovered automatically after workers restarted.

## Timeline (UTC)

1. 18:02: Started benchmark workload (25 runs, fan-out/fan-in DAG).
2. 18:03: Killed all worker processes.
3. 18:03-18:04: Active tasks stopped heartbeating.
4. 18:04: Reaper detected expired leases and moved tasks to retry path.
5. 18:05: Restarted workers.
6. 18:05-18:07: Tasks drained; no stuck `running` tasks remained.
7. 18:08: Runs reached terminal states (mostly succeeded, expected flaky retries observed).

## Impact

- Temporary run latency increase.
- No orphaned task state after lease timeout.
- No duplicate run creation.

## Root Cause

This was a controlled failure drill; primary risk validated was worker process loss during in-flight execution.

## What Worked

- Lease timeout and reaper logic restored dispatch flow.
- Retry/backoff prevented immediate thrash.
- Attempt history and error fields provided useful diagnostics.

## Gaps Found

- SSE feed reconnect handling in UI could be more robust.
- Alert routing beyond local dashboards is not configured yet.

## Corrective Actions

1. Add worker liveness/heartbeat alert thresholds in Grafana.
2. Add explicit UI banner when SSE stream disconnects.
3. Add integration test that simulates lease expiry + worker restart loop.
