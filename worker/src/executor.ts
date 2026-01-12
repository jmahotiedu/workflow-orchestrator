type TaskPayload = {
  kind?: string;
  config?: Record<string, unknown>;
  timeoutMs?: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function calculateBackoffMs(attemptCount: number): number {
  const base = 1000;
  const factor = 2 ** Math.max(0, attemptCount - 1);
  return Math.min(base * factor, 30_000);
}

export async function executeTaskPayload(payload: TaskPayload, attemptCount: number): Promise<void> {
  const kind = payload.kind ?? "noop";
  const config = payload.config ?? {};

  if (kind === "noop") {
    const duration = Number(config.durationMs ?? 100);
    await delay(Math.max(1, duration));
    return;
  }

  if (kind === "flaky") {
    const failUntilAttempt = Number(config.failUntilAttempt ?? 1);
    const duration = Number(config.durationMs ?? 100);
    await delay(Math.max(1, duration));
    if (attemptCount <= failUntilAttempt) {
      throw new Error(`flaky task failed at attempt ${attemptCount}`);
    }
    return;
  }

  throw new Error(`Unsupported task kind: ${kind}`);
}
