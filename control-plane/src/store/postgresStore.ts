import type {
  RunRecord,
  RunStatus,
  TaskRecord,
  TriggerSource,
  WorkflowDefinition,
  WorkflowRecord
} from "@orchestrator/shared";
import { withTransaction } from "../db.js";
import type { CreateRunInput, CreateWorkflowInput, EnqueueCandidate } from "./types.js";

type WorkflowRow = {
  id: string;
  name: string;
  definition: WorkflowDefinition;
  schedule: string | null;
  max_concurrent_runs: number;
  created_at: Date;
  updated_at: Date;
};

type RunRow = {
  id: string;
  workflow_id: string;
  status: RunStatus;
  trigger_source: TriggerSource;
  idempotency_key: string | null;
  cancel_requested: boolean;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
};

type TaskRow = {
  id: string;
  run_id: string;
  workflow_id: string;
  node_id: string;
  status: TaskRecord["status"];
  attempt_count: number;
  max_attempts: number;
  depends_on: string[];
  remaining_deps: number;
  payload: Record<string, unknown>;
  worker_id: string | null;
  lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  last_error: string | null;
  next_attempt_at: Date;
  created_at: Date;
  updated_at: Date;
};

export class PostgresStore {
  async createWorkflow(input: CreateWorkflowInput): Promise<WorkflowRecord> {
    const result = await withTransaction(async (client) => {
      const inserted = await client.query<WorkflowRow>(
        `INSERT INTO workflows (name, definition, schedule, max_concurrent_runs)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [input.name, JSON.stringify(input.definition), input.schedule ?? null, input.maxConcurrentRuns ?? 1]
      );
      return inserted.rows[0];
    });
    return toWorkflowRecord(result);
  }

  async listWorkflows(): Promise<WorkflowRecord[]> {
    const rows = await withTransaction(async (client) => {
      const result = await client.query<WorkflowRow>("SELECT * FROM workflows ORDER BY created_at DESC");
      return result.rows;
    });
    return rows.map(toWorkflowRecord);
  }

  async getWorkflow(workflowId: string): Promise<WorkflowRecord | null> {
    const row = await withTransaction(async (client) => {
      const result = await client.query<WorkflowRow>("SELECT * FROM workflows WHERE id = $1", [workflowId]);
      return result.rows[0] ?? null;
    });
    return row ? toWorkflowRecord(row) : null;
  }

  async countActiveRunsForWorkflow(workflowId: string): Promise<number> {
    const count = await withTransaction(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM runs
         WHERE workflow_id = $1
           AND status IN ('pending', 'running')`,
        [workflowId]
      );
      return Number.parseInt(result.rows[0].count, 10);
    });
    return count;
  }

  async countGlobalActiveRuns(): Promise<number> {
    const count = await withTransaction(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM runs
         WHERE status IN ('pending', 'running')`
      );
      return Number.parseInt(result.rows[0].count, 10);
    });
    return count;
  }

  async createRun(input: CreateRunInput): Promise<{ run: RunRecord; deduped: boolean }> {
    return withTransaction(async (client) => {
      const inserted = await client.query<RunRow>(
        `INSERT INTO runs (workflow_id, status, trigger_source, idempotency_key)
         VALUES ($1, 'pending', $2, $3)
         ON CONFLICT (workflow_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [input.workflowId, input.triggerSource, input.idempotencyKey ?? null]
      );

      if (inserted.rows[0]) {
        return { run: toRunRecord(inserted.rows[0]), deduped: false };
      }

      if (!input.idempotencyKey) {
        throw new Error("Failed to create run without idempotency key.");
      }

      const existing = await client.query<RunRow>(
        `SELECT * FROM runs WHERE workflow_id = $1 AND idempotency_key = $2`,
        [input.workflowId, input.idempotencyKey]
      );

      if (!existing.rows[0]) {
        throw new Error("Idempotency conflict occurred but existing run was not found.");
      }

      return { run: toRunRecord(existing.rows[0]), deduped: true };
    });
  }

  async seedTasksForRun(runId: string, workflow: WorkflowRecord): Promise<void> {
    await withTransaction(async (client) => {
      for (const task of workflow.definition.tasks) {
        const dependsOn = task.dependsOn ?? [];
        await client.query(
          `INSERT INTO tasks (
             run_id,
             workflow_id,
             node_id,
             status,
             max_attempts,
             depends_on,
             remaining_deps,
             payload
           ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)`,
          [
            runId,
            workflow.id,
            task.id,
            task.maxAttempts ?? 3,
            dependsOn,
            dependsOn.length,
            JSON.stringify({
              kind: task.kind,
              config: task.config ?? {},
              timeoutMs: task.timeoutMs ?? 10000
            })
          ]
        );
      }
    });
  }

  async startRunIfPending(runId: string): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE runs
         SET status = 'running',
             started_at = COALESCE(started_at, NOW())
         WHERE id = $1 AND status = 'pending'`,
        [runId]
      );
    });
  }

  async queueReadyTasks(runId: string): Promise<EnqueueCandidate[]> {
    return withTransaction(async (client) => {
      const result = await client.query<{
        task_id: string;
        run_id: string;
        workflow_id: string;
        next_attempt_at: Date;
      }>(
        `WITH due AS (
            SELECT id
            FROM tasks
            WHERE run_id = $1
              AND status = 'pending'
              AND remaining_deps = 0
              AND next_attempt_at <= NOW()
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
         )
         UPDATE tasks t
         SET status = 'queued',
             updated_at = NOW()
         FROM due
         WHERE t.id = due.id
         RETURNING
           t.id AS task_id,
           t.run_id,
           t.workflow_id,
           t.next_attempt_at`,
        [runId]
      );
      return result.rows.map((row) => ({
        taskId: row.task_id,
        runId: row.run_id,
        workflowId: row.workflow_id,
        nextAttemptAt: row.next_attempt_at.toISOString()
      }));
    });
  }

  async queueDuePendingTasks(limit = 200): Promise<EnqueueCandidate[]> {
    return withTransaction(async (client) => {
      const result = await client.query<{
        task_id: string;
        run_id: string;
        workflow_id: string;
        next_attempt_at: Date;
      }>(
        `WITH due AS (
            SELECT id
            FROM tasks
            WHERE status = 'pending'
              AND remaining_deps = 0
              AND next_attempt_at <= NOW()
            ORDER BY next_attempt_at ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
         )
         UPDATE tasks t
         SET status = 'queued',
             updated_at = NOW()
         FROM due
         WHERE t.id = due.id
         RETURNING
           t.id AS task_id,
           t.run_id,
           t.workflow_id,
           t.next_attempt_at`,
        [limit]
      );
      return result.rows.map((row) => ({
        taskId: row.task_id,
        runId: row.run_id,
        workflowId: row.workflow_id,
        nextAttemptAt: row.next_attempt_at.toISOString()
      }));
    });
  }

  async getTaskById(taskId: string): Promise<TaskRecord | null> {
    const row = await withTransaction(async (client) => {
      const result = await client.query<TaskRow>("SELECT * FROM tasks WHERE id = $1", [taskId]);
      return result.rows[0] ?? null;
    });
    return row ? toTaskRecord(row) : null;
  }

  async startTask(taskId: string, workerId: string, leaseMs: number): Promise<TaskRecord | null> {
    const row = await withTransaction(async (client) => {
      const result = await client.query<TaskRow>(
        `UPDATE tasks
         SET status = 'running',
             worker_id = $2,
             attempt_count = attempt_count + 1,
             heartbeat_at = NOW(),
             lease_expires_at = NOW() + (($3::text || ' milliseconds')::interval),
             updated_at = NOW()
         WHERE id = $1
           AND status = 'queued'
         RETURNING *`,
        [taskId, workerId, leaseMs]
      );
      const task = result.rows[0];
      if (!task) return null;
      await client.query(
        `INSERT INTO task_attempts (task_id, attempt_no, status)
         VALUES ($1, $2, 'running')`,
        [task.id, task.attempt_count]
      );
      return task;
    });
    return row ? toTaskRecord(row) : null;
  }

  async heartbeatTask(taskId: string, workerId: string, leaseMs: number): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE tasks
         SET heartbeat_at = NOW(),
             lease_expires_at = NOW() + (($3::text || ' milliseconds')::interval),
             updated_at = NOW()
         WHERE id = $1
           AND status = 'running'
           AND worker_id = $2`,
        [taskId, workerId, leaseMs]
      );
    });
  }

  async completeTask(taskId: string): Promise<TaskRecord | null> {
    const row = await withTransaction(async (client) => {
      const result = await client.query<TaskRow>(
        `UPDATE tasks
         SET status = 'succeeded',
             worker_id = NULL,
             lease_expires_at = NULL,
             heartbeat_at = NULL,
             updated_at = NOW()
         WHERE id = $1
           AND status = 'running'
         RETURNING *`,
        [taskId]
      );
      const task = result.rows[0];
      if (!task) return null;
      await client.query(
        `UPDATE task_attempts
         SET status = 'succeeded',
             finished_at = NOW(),
             duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000
         WHERE task_id = $1
           AND attempt_no = $2`,
        [task.id, task.attempt_count]
      );
      return task;
    });
    return row ? toTaskRecord(row) : null;
  }

  async failTask(taskId: string, errorMessage: string, backoffMs: number): Promise<{
    task: TaskRecord | null;
    deadLettered: boolean;
  }> {
    return withTransaction(async (client) => {
      const current = await client.query<TaskRow>("SELECT * FROM tasks WHERE id = $1 FOR UPDATE", [taskId]);
      const task = current.rows[0];
      if (!task || task.status !== "running") {
        return { task: null, deadLettered: false };
      }

      await client.query(
        `UPDATE task_attempts
         SET status = 'failed',
             error = $2,
             finished_at = NOW(),
             duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000
         WHERE task_id = $1
           AND attempt_no = $3`,
        [task.id, errorMessage, task.attempt_count]
      );

      const reachedMaxAttempts = task.attempt_count >= task.max_attempts;
      if (reachedMaxAttempts) {
        const dead = await client.query<TaskRow>(
          `UPDATE tasks
           SET status = 'dead_letter',
               worker_id = NULL,
               lease_expires_at = NULL,
               heartbeat_at = NULL,
               last_error = $2,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [task.id, errorMessage]
        );
        const deadTask = dead.rows[0];
        await client.query(
          `INSERT INTO dead_letters (task_id, run_id, workflow_id, reason, payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [deadTask.id, deadTask.run_id, deadTask.workflow_id, errorMessage, JSON.stringify(deadTask.payload)]
        );
        return { task: toTaskRecord(deadTask), deadLettered: true };
      }

      const pending = await client.query<TaskRow>(
        `UPDATE tasks
         SET status = 'pending',
             worker_id = NULL,
             lease_expires_at = NULL,
             heartbeat_at = NULL,
             last_error = $2,
             next_attempt_at = NOW() + (($3::text || ' milliseconds')::interval),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [task.id, errorMessage, backoffMs]
      );
      return { task: toTaskRecord(pending.rows[0]), deadLettered: false };
    });
  }

  async markDependentsAfterSuccess(runId: string, completedNodeId: string): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE tasks
         SET remaining_deps = GREATEST(remaining_deps - 1, 0),
             updated_at = NOW()
         WHERE run_id = $1
           AND status = 'pending'
           AND $2 = ANY(depends_on)
           AND remaining_deps > 0`,
        [runId, completedNodeId]
      );
    });
  }

  async listRuns(workflowId?: string): Promise<RunRecord[]> {
    const rows = await withTransaction(async (client) => {
      if (workflowId) {
        const result = await client.query<RunRow>(
          `SELECT * FROM runs WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 200`,
          [workflowId]
        );
        return result.rows;
      }
      const result = await client.query<RunRow>("SELECT * FROM runs ORDER BY created_at DESC LIMIT 200");
      return result.rows;
    });
    return rows.map(toRunRecord);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const row = await withTransaction(async (client) => {
      const result = await client.query<RunRow>("SELECT * FROM runs WHERE id = $1", [runId]);
      return result.rows[0] ?? null;
    });
    return row ? toRunRecord(row) : null;
  }

  async listTasksForRun(runId: string): Promise<TaskRecord[]> {
    const rows = await withTransaction(async (client) => {
      const result = await client.query<TaskRow>(
        `SELECT *
         FROM tasks
         WHERE run_id = $1
         ORDER BY created_at ASC`,
        [runId]
      );
      return result.rows;
    });
    return rows.map(toTaskRecord);
  }

  async cancelRun(runId: string): Promise<RunRecord | null> {
    return withTransaction(async (client) => {
      const runResult = await client.query<RunRow>(
        `UPDATE runs
         SET cancel_requested = TRUE,
             status = CASE WHEN status IN ('pending', 'running') THEN 'cancelled' ELSE status END,
             finished_at = CASE WHEN finished_at IS NULL THEN NOW() ELSE finished_at END
         WHERE id = $1
         RETURNING *`,
        [runId]
      );

      const run = runResult.rows[0];
      if (!run) return null;

      await client.query(
        `UPDATE tasks
         SET status = 'cancelled',
             worker_id = NULL,
             lease_expires_at = NULL,
             heartbeat_at = NULL,
             updated_at = NOW()
         WHERE run_id = $1
           AND status IN ('pending', 'queued', 'running')`,
        [runId]
      );
      return toRunRecord(run);
    });
  }

  async updateRunStatus(runId: string, status: RunStatus, error?: string): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE runs
         SET status = $2,
             error = CASE WHEN $3::text IS NULL THEN error ELSE $3 END,
             started_at = CASE WHEN $2 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
             finished_at = CASE WHEN $2 IN ('succeeded', 'failed', 'cancelled') AND finished_at IS NULL THEN NOW() ELSE finished_at END
         WHERE id = $1`,
        [runId, status, error ?? null]
      );
    });
  }

  async evaluateRunState(runId: string): Promise<RunStatus | null> {
    return withTransaction(async (client) => {
      const result = await client.query<{
        pending_count: string;
        queued_count: string;
        running_count: string;
        failed_count: string;
        dead_count: string;
        succeeded_count: string;
        cancelled_count: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')::text AS pending_count,
           COUNT(*) FILTER (WHERE status = 'queued')::text AS queued_count,
           COUNT(*) FILTER (WHERE status = 'running')::text AS running_count,
           COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_count,
           COUNT(*) FILTER (WHERE status = 'dead_letter')::text AS dead_count,
           COUNT(*) FILTER (WHERE status = 'succeeded')::text AS succeeded_count,
           COUNT(*) FILTER (WHERE status = 'cancelled')::text AS cancelled_count
         FROM tasks
         WHERE run_id = $1`,
        [runId]
      );

      const runResult = await client.query<RunRow>("SELECT * FROM runs WHERE id = $1", [runId]);
      const run = runResult.rows[0];
      if (!run) return null;

      const counts = result.rows[0];
      const pending = Number.parseInt(counts.pending_count, 10);
      const queued = Number.parseInt(counts.queued_count, 10);
      const running = Number.parseInt(counts.running_count, 10);
      const failed = Number.parseInt(counts.failed_count, 10);
      const dead = Number.parseInt(counts.dead_count, 10);
      const succeeded = Number.parseInt(counts.succeeded_count, 10);
      const cancelled = Number.parseInt(counts.cancelled_count, 10);
      const total = pending + queued + running + failed + dead + succeeded + cancelled;

      if (total === 0) return run.status;
      if (run.cancel_requested) return "cancelled";
      if (dead > 0 || failed > 0) return "failed";
      if (pending > 0 || queued > 0 || running > 0) return "running";
      return "succeeded";
    });
  }

  async recoverExpiredLeases(limit = 200): Promise<TaskRecord[]> {
    return withTransaction(async (client) => {
      const expired = await client.query<TaskRow>(
        `SELECT *
         FROM tasks
         WHERE status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at < NOW()
         ORDER BY lease_expires_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit]
      );

      const recovered: TaskRecord[] = [];

      for (const task of expired.rows) {
        await client.query(
          `UPDATE task_attempts
           SET status = 'failed',
               error = 'lease expired',
               finished_at = NOW(),
               duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000
           WHERE task_id = $1
             AND attempt_no = $2`,
          [task.id, task.attempt_count]
        );

        if (task.attempt_count >= task.max_attempts) {
          const dead = await client.query<TaskRow>(
            `UPDATE tasks
             SET status = 'dead_letter',
                 worker_id = NULL,
                 lease_expires_at = NULL,
                 heartbeat_at = NULL,
                 last_error = 'lease expired',
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [task.id]
          );
          const deadTask = dead.rows[0];
          await client.query(
            `INSERT INTO dead_letters (task_id, run_id, workflow_id, reason, payload)
             VALUES ($1, $2, $3, 'lease expired', $4)`,
            [deadTask.id, deadTask.run_id, deadTask.workflow_id, JSON.stringify(deadTask.payload)]
          );
          recovered.push(toTaskRecord(deadTask));
          continue;
        }

        const retry = await client.query<TaskRow>(
          `UPDATE tasks
           SET status = 'pending',
               worker_id = NULL,
               lease_expires_at = NULL,
               heartbeat_at = NULL,
               last_error = 'lease expired',
               next_attempt_at = NOW(),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [task.id]
        );
        recovered.push(toTaskRecord(retry.rows[0]));
      }

      return recovered;
    });
  }
}

function toWorkflowRecord(row: WorkflowRow): WorkflowRecord {
  return {
    id: row.id,
    name: row.name,
    definition: row.definition,
    schedule: row.schedule,
    maxConcurrentRuns: row.max_concurrent_runs,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status,
    triggerSource: row.trigger_source,
    idempotencyKey: row.idempotency_key,
    cancelRequested: row.cancel_requested,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    error: row.error
  };
}

function toTaskRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    runId: row.run_id,
    workflowId: row.workflow_id,
    nodeId: row.node_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    dependsOn: row.depends_on,
    remainingDeps: row.remaining_deps,
    payload: row.payload,
    workerId: row.worker_id,
    leaseExpiresAt: row.lease_expires_at ? row.lease_expires_at.toISOString() : null,
    heartbeatAt: row.heartbeat_at ? row.heartbeat_at.toISOString() : null,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
