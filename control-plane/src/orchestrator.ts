import type { RunRecord, TriggerSource } from "@orchestrator/shared";
import { appEvents } from "./events.js";
import { runCreatedCounter, runStatusGauge, taskStatusCounter } from "./metrics/metrics.js";
import { RedisQueue } from "./queue/redisQueue.js";
import { PostgresStore } from "./store/postgresStore.js";

export class OrchestratorService {
  constructor(
    private readonly store: PostgresStore,
    private readonly queue: RedisQueue,
    private readonly globalActiveRunLimit: number
  ) {}

  async triggerRun(params: {
    workflowId: string;
    triggerSource: TriggerSource;
    idempotencyKey?: string | null;
  }): Promise<{ run: RunRecord; deduped: boolean }> {
    const workflow = await this.store.getWorkflow(params.workflowId);
    if (!workflow) {
      throw new Error("Workflow not found.");
    }

    const activeForWorkflow = await this.store.countActiveRunsForWorkflow(workflow.id);
    if (activeForWorkflow >= workflow.maxConcurrentRuns) {
      throw new Error("Workflow concurrency limit reached.");
    }

    const globalActiveRuns = await this.store.countGlobalActiveRuns();
    if (globalActiveRuns >= this.globalActiveRunLimit) {
      throw new Error("Global active run limit reached.");
    }

    const created = await this.store.createRun({
      workflowId: workflow.id,
      triggerSource: params.triggerSource,
      idempotencyKey: params.idempotencyKey ?? null
    });

    if (created.deduped) {
      return created;
    }

    await this.store.seedTasksForRun(created.run.id, workflow);
    await this.store.startRunIfPending(created.run.id);

    const ready = await this.store.queueReadyTasks(created.run.id);
    for (const task of ready) {
      await this.queue.enqueueTask({
        taskId: task.taskId,
        runId: task.runId,
        workflowId: task.workflowId
      });
      taskStatusCounter.inc({ status: "queued" });
      appEvents.emitEvent({
        type: "task.updated",
        taskId: task.taskId,
        runId: task.runId,
        status: "queued"
      });
    }

    runCreatedCounter.inc({ trigger_source: params.triggerSource });
    runStatusGauge.inc({ status: "running" });
    appEvents.emitEvent({
      type: "run.created",
      runId: created.run.id,
      workflowId: created.run.workflowId
    });
    return created;
  }

  async syncRunStatus(runId: string): Promise<void> {
    const status = await this.store.evaluateRunState(runId);
    if (!status) return;
    await this.store.updateRunStatus(runId, status);
    appEvents.emitEvent({ type: "run.updated", runId, status });
  }
}
