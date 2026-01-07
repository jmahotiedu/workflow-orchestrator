CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  definition JSONB NOT NULL,
  schedule TEXT NULL,
  max_concurrent_runs INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrent_runs > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  idempotency_key TEXT NULL,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  error TEXT NULL,
  UNIQUE (workflow_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  depends_on TEXT[] NOT NULL DEFAULT '{}',
  remaining_deps INTEGER NOT NULL DEFAULT 0 CHECK (remaining_deps >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  worker_id TEXT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  heartbeat_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, node_id)
);

CREATE TABLE IF NOT EXISTS task_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL,
  duration_ms INTEGER NULL
);

CREATE TABLE IF NOT EXISTS dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL,
  run_id UUID NOT NULL,
  workflow_id UUID NOT NULL,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_workflow_status ON runs (workflow_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_run_status ON tasks (run_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_status_next_attempt ON tasks (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_tasks_lease_expires ON tasks (lease_expires_at);
