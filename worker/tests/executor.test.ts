import { describe, expect, it } from "vitest";
import { calculateBackoffMs, executeTaskPayload } from "../src/executor.js";

describe("calculateBackoffMs", () => {
  it("grows exponentially and caps", () => {
    expect(calculateBackoffMs(1)).toBe(1000);
    expect(calculateBackoffMs(2)).toBe(2000);
    expect(calculateBackoffMs(5)).toBe(16000);
    expect(calculateBackoffMs(10)).toBe(30000);
  });
});

describe("executeTaskPayload", () => {
  it("executes noop", async () => {
    await expect(executeTaskPayload({ kind: "noop", config: { durationMs: 1 } }, 1)).resolves.toBeUndefined();
  });

  it("fails flaky before threshold then succeeds", async () => {
    await expect(
      executeTaskPayload({ kind: "flaky", config: { failUntilAttempt: 2, durationMs: 1 } }, 1)
    ).rejects.toThrow("flaky task failed");
    await expect(
      executeTaskPayload({ kind: "flaky", config: { failUntilAttempt: 2, durationMs: 1 } }, 3)
    ).resolves.toBeUndefined();
  });
});
