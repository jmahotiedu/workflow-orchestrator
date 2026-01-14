import { queuePumpCounter } from "../metrics/metrics.js";
import { RedisQueue } from "../queue/redisQueue.js";
import { PostgresStore } from "../store/postgresStore.js";

export class RecoveryReaper {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: PostgresStore,
    private readonly queue: RedisQueue,
    private readonly intervalMs: number
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error("reaper tick failed", error);
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    await this.store.recoverExpiredLeases();
    await this.queue.pumpDelayed();
    const due = await this.store.queueDuePendingTasks();
    if (due.length > 0) {
      queuePumpCounter.inc(due.length);
    }
    for (const task of due) {
      await this.queue.enqueueTask({
        taskId: task.taskId,
        runId: task.runId,
        workflowId: task.workflowId
      });
    }
  }
}
