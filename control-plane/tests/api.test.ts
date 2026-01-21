import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

function makeApp() {
  const store = {
    createWorkflow: vi.fn(async () => ({
      id: "wf-1",
      name: "demo",
      definition: { version: 1, tasks: [{ id: "a", name: "A", kind: "noop" }] },
      schedule: null,
      maxConcurrentRuns: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })),
    listWorkflows: vi.fn(async () => []),
    getWorkflow: vi.fn(async () => null),
    listRuns: vi.fn(async () => []),
    getRun: vi.fn(async () => null),
    listTasksForRun: vi.fn(async () => []),
    cancelRun: vi.fn(async () => null)
  };

  const orchestrator = {
    triggerRun: vi.fn(),
    syncRunStatus: vi.fn()
  };

  return createApp({
    config: {
      ...config,
      requestPerMinute: 1000,
      tokenMap: new Map([
        ["admin-token", "admin"],
        ["operator-token", "operator"],
        ["viewer-token", "viewer"]
      ])
    },
    store: store as never,
    orchestrator: orchestrator as never
  });
}

describe("API auth + validation", () => {
  it("requires authentication", async () => {
    const app = makeApp();
    const response = await request(app).get("/api/workflows");
    expect(response.status).toBe(401);
  });

  it("rejects invalid workflow definitions", async () => {
    const app = makeApp();
    const response = await request(app)
      .post("/api/workflows")
      .set("Authorization", "Bearer admin-token")
      .send({
        name: "bad",
        definition: {
          version: 1,
          tasks: [{ id: "a", name: "A", kind: "noop", dependsOn: ["missing"] }]
        }
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("invalid");
  });
});
