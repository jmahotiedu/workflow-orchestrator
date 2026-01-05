import { describe, expect, it } from "vitest";
import { canTransitionRun, canTransitionTask } from "../src/stateMachine.js";

describe("run state machine", () => {
  it("allows pending -> running", () => {
    expect(canTransitionRun("pending", "running")).toBe(true);
  });

  it("blocks terminal transitions", () => {
    expect(canTransitionRun("succeeded", "running")).toBe(false);
  });
});

describe("task state machine", () => {
  it("allows queued -> running", () => {
    expect(canTransitionTask("queued", "running")).toBe(true);
  });

  it("allows running -> pending for retries", () => {
    expect(canTransitionTask("running", "pending")).toBe(true);
  });

  it("blocks dead letter escape", () => {
    expect(canTransitionTask("dead_letter", "pending")).toBe(false);
  });
});
