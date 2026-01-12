import { calculateBackoffMs, executeTaskPayload } from "./executor.js";
import { startMetricsServer, taskExecutionCounter, taskExecutionLatency } from "./metrics.js";
import { WorkerQueue } from "./queue.js";
import { config } from "./config.js";
import { WorkerStore } from "./store.js";
import { getPool } from "./db.js";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`task timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function processMessage(params: {
  queue: WorkerQueue;
  store: WorkerStore;
  message: { messageId: string; taskId: string; runId: string; workflowId: string };
}): Promise<void> {
  const { queue, store, message } = params;
  const envelope = await store.getTaskEnvelope(message.taskId);
  if (!envelope || envelope.status !== "queued") {
    await queue.ack(message.messageId);
    return;
  }
  if (envelope.cancelRequested || envelope.runStatus === "cancelled") {
    await queue.ack(message.messageId);
    await store.refreshRunStatus(envelope.runId);
    return;
  }

  const started = await store.startTask(message.taskId, config.workerId, config.leaseMs);
  if (!started) {
    await queue.ack(message.messageId);
    return;
  }

  const timeoutMs = Number(started.payload.timeoutMs ?? 10_000);
  const heartbeat = setInterval(() => {
    store.heartbeatTask(started.id, config.workerId, config.leaseMs).catch((error) => {
      console.error("heartbeat failed", error);
    });
  }, config.heartbeatMs);

  const startNs = process.hrtime.bigint();
  try {
    await withTimeout(executeTaskPayload(started.payload, started.attemptCount), timeoutMs);
    await store.markTaskSucceeded(started.id);
    taskExecutionCounter.inc({ status: "succeeded" });

    const ready = await store.queueReadyTasksForRun(started.runId);
    for (const task of ready) {
      await queue.requeue(task, 0);
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const backoffMs = calculateBackoffMs(started.attemptCount);
    const result = await store.markTaskFailed(started.id, messageText, backoffMs);
    taskExecutionCounter.inc({ status: result.deadLettered ? "dead_letter" : "failed" });
    if (!result.deadLettered && result.runId && result.workflowId) {
      await queue.requeue(
        {
          taskId: started.id,
          runId: result.runId,
          workflowId: result.workflowId
        },
        backoffMs
      );
    }
  } finally {
    clearInterval(heartbeat);
    await store.refreshRunStatus(started.runId);
    await queue.ack(message.messageId);
    const durationSec = Number(process.hrtime.bigint() - startNs) / 1_000_000_000;
    taskExecutionLatency.observe(durationSec);
  }
}

async function main(): Promise<void> {
  const queue = new WorkerQueue(config.redisUrl);
  const store = new WorkerStore();
  await queue.ensureConsumerGroup();
  const metricsServer = startMetricsServer(config.metricsPort);

  let running = true;
  const shutdown = async () => {
    running = false;
    await queue.close();
    await getPool().end();
    metricsServer.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });
  process.on("SIGTERM", () => {
    shutdown().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });

  while (running) {
    const reclaimed = await queue.claimStale(config.workerId, config.leaseMs, config.maxBatch);
    const fresh = await queue.readBatch(config.workerId, config.maxBatch);
    const messages = [...reclaimed, ...fresh];
    if (messages.length === 0) {
      continue;
    }
    for (const message of messages) {
      await processMessage({ queue, store, message });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
