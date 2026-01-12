import RedisPackage from "ioredis";

export const TASK_STREAM = "task_queue_stream";
export const TASK_GROUP = "task_workers";

export interface StreamTaskMessage {
  messageId: string;
  taskId: string;
  runId: string;
  workflowId: string;
}

function parseFields(raw: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < raw.length; i += 2) {
    const key = raw[i];
    const value = raw[i + 1];
    record[key] = value;
  }
  return record;
}

export class WorkerQueue {
  private readonly redis: any;

  constructor(redisUrl: string) {
    const RedisCtor = RedisPackage as unknown as { new (url: string): any };
    this.redis = new RedisCtor(redisUrl);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", TASK_STREAM, TASK_GROUP, "0", "MKSTREAM");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("BUSYGROUP")) {
        throw error;
      }
    }
  }

  async readBatch(consumerId: string, count: number): Promise<StreamTaskMessage[]> {
    const response = (await this.redis.xreadgroup(
      "GROUP",
      TASK_GROUP,
      consumerId,
      "COUNT",
      count,
      "BLOCK",
      2500,
      "STREAMS",
      TASK_STREAM,
      ">"
    )) as unknown as [string, [string, string[]][]][] | null;

    if (!response || response.length === 0) return [];
    const records = response[0]?.[1] ?? [];
    return records.flatMap(([messageId, fields]) => {
      const parsed = parseFields(fields);
      if (!parsed.taskId || !parsed.runId || !parsed.workflowId) return [];
      return [
        {
          messageId,
          taskId: parsed.taskId,
          runId: parsed.runId,
          workflowId: parsed.workflowId
        }
      ];
    });
  }

  async claimStale(consumerId: string, minIdleMs: number, count: number): Promise<StreamTaskMessage[]> {
    const response = (await this.redis.xautoclaim(
      TASK_STREAM,
      TASK_GROUP,
      consumerId,
      minIdleMs,
      "0-0",
      "COUNT",
      count
    )) as unknown as [string, [string, string[]][]];

    const records = response?.[1] ?? [];
    return records.flatMap(([messageId, fields]) => {
      const parsed = parseFields(fields);
      if (!parsed.taskId || !parsed.runId || !parsed.workflowId) return [];
      return [
        {
          messageId,
          taskId: parsed.taskId,
          runId: parsed.runId,
          workflowId: parsed.workflowId
        }
      ];
    });
  }

  async ack(messageId: string): Promise<void> {
    await this.redis.xack(TASK_STREAM, TASK_GROUP, messageId);
  }

  async requeue(task: { taskId: string; runId: string; workflowId: string }, delayMs = 0): Promise<void> {
    if (delayMs > 0) {
      await this.redis.zadd("task_queue_delayed", Date.now() + delayMs, JSON.stringify(task));
      return;
    }
    await this.redis.xadd(
      TASK_STREAM,
      "*",
      "taskId",
      task.taskId,
      "runId",
      task.runId,
      "workflowId",
      task.workflowId
    );
  }
}
