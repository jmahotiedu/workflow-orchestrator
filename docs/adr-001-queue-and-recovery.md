# ADR-001: Queue Semantics and Recovery

## Status
Accepted

## Context

The orchestrator needs distributed task execution with crash recovery and clear task history. We need predictable behavior under worker failure while keeping implementation complexity manageable for a portfolio project.

## Decision

- Use Redis Streams + consumer groups for task dispatch.
- Persist authoritative task state in Postgres.
- Use DB-backed task lease (`lease_expires_at`) and periodic heartbeats.
- Reap expired leases and transition tasks to retry or dead-letter.
- Use at-least-once processing model.

## Consequences

Positive:
- Strong operational transparency from persisted attempts and task states.
- Simple and demonstrable recovery model.
- Supports horizontal worker scaling.

Negative:
- Potential duplicate execution on retry/reclaim paths.
- Requires idempotent task handlers and side-effect design discipline.
