import { describe, expect, it } from "vitest";
import { validateWorkflowDefinition } from "../src/dag.js";

describe("validateWorkflowDefinition", () => {
  it("accepts a valid DAG", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      tasks: [
        { id: "a", name: "A", kind: "noop" },
        { id: "b", name: "B", kind: "flaky", dependsOn: ["a"] }
      ]
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects cycles", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      tasks: [
        { id: "a", name: "A", kind: "noop", dependsOn: ["b"] },
        { id: "b", name: "B", kind: "noop", dependsOn: ["a"] }
      ]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.message.includes("acyclic"))).toBe(true);
  });

  it("rejects unknown dependencies", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      tasks: [{ id: "a", name: "A", kind: "noop", dependsOn: ["missing"] }]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.message.includes("Unknown dependency"))).toBe(true);
  });
});
