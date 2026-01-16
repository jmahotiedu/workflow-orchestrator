import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import type { WorkflowRecord } from "@orchestrator/shared";
import { PostgresStore } from "../store/postgresStore.js";

type TriggerHandler = (workflowId: string) => Promise<void>;

export class WorkflowScheduler {
  private readonly jobs = new Map<string, ScheduledTask>();
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: PostgresStore,
    private readonly onTrigger: TriggerHandler
  ) {}

  async start(): Promise<void> {
    await this.refresh();
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((error) => {
        console.error("scheduler refresh failed", error);
      });
    }, 30_000);
  }

  async stop(): Promise<void> {
    this.jobs.forEach((job) => job.stop());
    this.jobs.clear();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refresh(): Promise<void> {
    const workflows = await this.store.listWorkflows();
    const seen = new Set<string>();
    workflows.forEach((workflow) => {
      seen.add(workflow.id);
      this.ensureJob(workflow);
    });

    for (const [workflowId, job] of this.jobs.entries()) {
      if (!seen.has(workflowId)) {
        job.stop();
        this.jobs.delete(workflowId);
      }
    }
  }

  private ensureJob(workflow: WorkflowRecord): void {
    if (!workflow.schedule || !cron.validate(workflow.schedule)) {
      const existing = this.jobs.get(workflow.id);
      if (existing) {
        existing.stop();
        this.jobs.delete(workflow.id);
      }
      return;
    }

    const current = this.jobs.get(workflow.id);
    if (current) return;

    const task = cron.schedule(workflow.schedule, () => {
      this.onTrigger(workflow.id).catch((error) => {
        console.error(`scheduler trigger failed for workflow ${workflow.id}`, error);
      });
    });
    this.jobs.set(workflow.id, task);
  }
}
