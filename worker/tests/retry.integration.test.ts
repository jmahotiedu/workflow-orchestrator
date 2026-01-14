import { describe, expect, it } from "vitest";
import { calculateBackoffMs } from "../src/executor.js";

describe("retry backoff schedule", () => {
  it("matches expected progression", () => {
    expect([1, 2, 3, 4].map((attempt) => calculateBackoffMs(attempt))).toEqual([
      1000, 2000, 4000, 8000
    ]);
  });
});
