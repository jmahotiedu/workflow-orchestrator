import { getPool } from "./db.js";

export interface TaskEnvelope {
  id: string;
  runId: string;
  workflowId: string;
  nodeId: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  cancelRequested: boolean;
  runStatus: string;
}

type TaskRow = {
  id: string;
  run_id: string;
  workflow_id: string;
  node_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  cancel_requested: boolean;
  run_status: string;
};

export class WorkerStore {
  async getTaskEnvelope(taskId: string): Promise<TaskEnvelope | null> {
    const pool = getPool();
    const result = await pool.query<TaskRow>(
      `SELECT
         t.id,
         t.run_id,
         t.workflow_id,
         t.node_id,
         t.status,
         t.attempt_count,
         t.max_attempts,
         t.payload,
         r.cancel_requested,
         r.status AS run_status
       FROM tasks t
       JOIN runs r ON r.id = t.run_id
       WHERE t.id = $1`,
      [taskId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      runId: row.run_id,
      workflowId: row.workflow_id,
      nodeId: row.node_id,
      status: row.status,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      payload: row.payload,
      cancelRequested: row.cancel_requested,
      runStatus: row.run_status
    };
  }

  async startTask(taskId: string, workerId: string, leaseMs: number): Promise<TaskEnvelope | null> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
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
         RETURNING
           id,
           run_id,
           workflow_id,
           node_id,
           status,
           attempt_count,
           max_attempts,
           payload,
           FALSE AS cancel_requested,
           'running'::text AS run_status`,
        [taskId, workerId, leaseMs]
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `INSERT INTO task_attempts (task_id, attempt_no, status)
         VALUES ($1, $2, 'running')`,
        [row.id, row.attempt_count]
      );
      await client.query("COMMIT");
      return {
        id: row.id,
        runId: row.run_id,
        workflowId: row.workflow_id,
        nodeId: row.node_id,
        status: row.status,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        payload: row.payload,
        cancelRequested: false,
        runStatus: "running"
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeatTask(taskId: string, workerId: string, leaseMs: number): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE tasks
       SET heartbeat_at = NOW(),
           lease_expires_at = NOW() + (($3::text || ' milliseconds')::interval),
           updated_at = NOW()
       WHERE id = $1
         AND status = 'running'
         AND worker_id = $2`,
      [taskId, workerId, leaseMs]
    );
  }

  async markTaskSucceeded(taskId: string): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ run_id: string; node_id: string; attempt_count: number }>(
        `UPDATE tasks
         SET status = 'succeeded',
             worker_id = NULL,
             lease_expires_at = NULL,
             heartbeat_at = NULL,
             updated_at = NOW()
         WHERE id = $1
           AND status = 'running'
         RETURNING run_id, node_id, attempt_count`,
        [taskId]
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return;
      }

      await client.query(
        `UPDATE task_attempts
         SET status = 'succeeded',
             finished_at = NOW(),
             duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000
         WHERE task_id = $1
           AND attempt_no = $2`,
        [taskId, row.attempt_count]
      );

      await client.query(
        `UPDATE tasks
         SET remaining_deps = GREATEST(remaining_deps - 1, 0),
             updated_at = NOW()
         WHERE run_id = $1
           AND status = 'pending'
           AND $2 = ANY(depends_on)
           AND remaining_deps > 0`,
        [row.run_id, row.node_id]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markTaskFailed(taskId: string, errorMessage: string, backoffMs: number): Promise<{
    deadLettered: boolean;
    runId: string | null;
    workflowId: string | null;
  }> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{
        id: string;
        run_id: string;
        workflow_id: string;
        payload: Record<string, unknown>;
        attempt_count: number;
        max_attempts: number;
      }>(
        `SELECT id, run_id, workflow_id, payload, attempt_count, max_attempts
         FROM tasks
         WHERE id = $1
         FOR UPDATE`,
        [taskId]
      );
      const task = current.rows[0];
      if (!task) {
        await client.query("ROLLBACK");
        return { deadLettered: false, runId: null, workflowId: null };
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

      if (task.attempt_count >= task.max_attempts) {
        await client.query(
          `UPDATE tasks
           SET status = 'dead_letter',
               worker_id = NULL,
               lease_expires_at = NULL,
               heartbeat_at = NULL,
               last_error = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [task.id, errorMessage]
        );
        await client.query(
          `INSERT INTO dead_letters (task_id, run_id, workflow_id, reason, payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [task.id, task.run_id, task.workflow_id, errorMessage, JSON.stringify(task.payload)]
        );
        await client.query("COMMIT");
        return { deadLettered: true, runId: task.run_id, workflowId: task.workflow_id };
      }

      await client.query(
        `UPDATE tasks
         SET status = 'pending',
             worker_id = NULL,
             lease_expires_at = NULL,
             heartbeat_at = NULL,
             last_error = $2,
             next_attempt_at = NOW() + (($3::text || ' milliseconds')::interval),
             updated_at = NOW()
         WHERE id = $1`,
        [task.id, errorMessage, backoffMs]
      );

      await client.query("COMMIT");
      return { deadLettered: false, runId: task.run_id, workflowId: task.workflow_id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async queueReadyTasksForRun(runId: string): Promise<Array<{ taskId: string; runId: string; workflowId: string }>> {
    const pool = getPool();
    const result = await pool.query<{
      id: string;
      run_id: string;
      workflow_id: string;
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
       RETURNING t.id, t.run_id, t.workflow_id`,
      [runId]
    );
    return result.rows.map((row) => ({
      taskId: row.id,
      runId: row.run_id,
      workflowId: row.workflow_id
    }));
  }

  async refreshRunStatus(runId: string): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const runResult = await client.query<{ cancel_requested: boolean }>(
        `SELECT cancel_requested FROM runs WHERE id = $1`,
        [runId]
      );
      const run = runResult.rows[0];
      if (!run) {
        await client.query("ROLLBACK");
        return;
      }

      const countsResult = await client.query<{
        pending_count: string;
        queued_count: string;
        running_count: string;
        failed_count: string;
        dead_count: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')::text AS pending_count,
           COUNT(*) FILTER (WHERE status = 'queued')::text AS queued_count,
           COUNT(*) FILTER (WHERE status = 'running')::text AS running_count,
           COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_count,
           COUNT(*) FILTER (WHERE status = 'dead_letter')::text AS dead_count
         FROM tasks
         WHERE run_id = $1`,
        [runId]
      );
      const counts = countsResult.rows[0];
      const pending = Number.parseInt(counts.pending_count, 10);
      const queued = Number.parseInt(counts.queued_count, 10);
      const running = Number.parseInt(counts.running_count, 10);
      const failed = Number.parseInt(counts.failed_count, 10);
      const dead = Number.parseInt(counts.dead_count, 10);

      let status = "running";
      if (run.cancel_requested) {
        status = "cancelled";
      } else if (dead > 0 || failed > 0) {
        status = "failed";
      } else if (pending === 0 && queued === 0 && running === 0) {
        status = "succeeded";
      }

      await client.query(
        `UPDATE runs
         SET status = $2,
             started_at = CASE WHEN status = 'pending' THEN NOW() ELSE started_at END,
             finished_at = CASE WHEN $2 IN ('succeeded', 'failed', 'cancelled') THEN COALESCE(finished_at, NOW()) ELSE finished_at END
         WHERE id = $1`,
        [runId, status]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
