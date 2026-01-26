import { config } from "./config.js";
import { createApp } from "./app.js";
import { OrchestratorService } from "./orchestrator.js";
import { RedisQueue } from "./queue/redisQueue.js";
import { RecoveryReaper } from "./recovery/reaper.js";
import { WorkflowScheduler } from "./scheduler/scheduler.js";
import { PostgresStore } from "./store/postgresStore.js";

async function main(): Promise<void> {
  const store = new PostgresStore();
  const queue = new RedisQueue(config.redisUrl);
  await queue.ensureConsumerGroup();

  const orchestrator = new OrchestratorService(store, queue, config.globalActiveRunLimit);
  const scheduler = new WorkflowScheduler(store, async (workflowId: string) => {
    const keyTime = new Date().toISOString().slice(0, 16);
    await orchestrator.triggerRun({
      workflowId,
      triggerSource: "schedule",
      idempotencyKey: `schedule:${workflowId}:${keyTime}`
    });
  });
  await scheduler.start();

  const reaper = new RecoveryReaper(store, queue, config.reaperIntervalMs);
  reaper.start();

  const app = createApp({ config, store, orchestrator });
  const server = app.listen(config.apiPort, () => {
    console.log(`control-plane listening on port ${config.apiPort}`);
  });

  const shutdown = async (): Promise<void> => {
    reaper.stop();
    await scheduler.stop();
    await queue.close();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", () => {
    shutdown().catch((error) => {
      console.error("shutdown failed", error);
      process.exit(1);
    });
  });
  process.on("SIGTERM", () => {
    shutdown().catch((error) => {
      console.error("shutdown failed", error);
      process.exit(1);
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
