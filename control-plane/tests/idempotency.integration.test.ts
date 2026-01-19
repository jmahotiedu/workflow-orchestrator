import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

describe("trigger idempotency", () => {
  it("returns 201 on create and 200 on dedupe", async () => {
    const orchestrator = {
      triggerRun: vi
        .fn()
        .mockResolvedValueOnce({
          run: { id: "run-1", workflowId: "wf-1", status: "running" },
          deduped: false
        })
        .mockResolvedValueOnce({
          run: { id: "run-1", workflowId: "wf-1", status: "running" },
          deduped: true
        }),
      syncRunStatus: vi.fn()
    };

    const store = {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => []),
      getWorkflow: vi.fn(),
      listRuns: vi.fn(async () => []),
      getRun: vi.fn(async () => null),
      listTasksForRun: vi.fn(async () => []),
      cancelRun: vi.fn(async () => null)
    };

    const app = createApp({
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

    const first = await request(app)
      .post("/api/workflows/wf-1/trigger")
      .set("Authorization", "Bearer operator-token")
      .set("Idempotency-Key", "abc")
      .send({ triggerSource: "event" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/workflows/wf-1/trigger")
      .set("Authorization", "Bearer operator-token")
      .set("Idempotency-Key", "abc")
      .send({ triggerSource: "event" });
    expect(second.status).toBe(200);
  });
});
