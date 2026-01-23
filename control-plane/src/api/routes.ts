import { Router } from "express";
import { parseWorkflowDefinition, validateWorkflowDefinition, type TriggerSource } from "@orchestrator/shared";
import { appEvents } from "../events.js";
import { workflowCreatedCounter } from "../metrics/metrics.js";
import type { OrchestratorService } from "../orchestrator.js";
import type { PostgresStore } from "../store/postgresStore.js";
import { requireRole, type AuthenticatedRequest } from "../auth/middleware.js";

export function createApiRouter(deps: {
  store: PostgresStore;
  orchestrator: OrchestratorService;
}): Router {
  const router = Router();

  router.post("/workflows", requireRole(["admin", "operator"]), async (request, response) => {
    try {
      const payload = request.body as {
        name?: string;
        definition?: unknown;
        schedule?: string | null;
        maxConcurrentRuns?: number;
      };
      if (!payload.name || payload.name.trim().length === 0) {
        response.status(400).json({ error: "name is required." });
        return;
      }

      const validation = validateWorkflowDefinition(payload.definition);
      if (!validation.valid) {
        response.status(400).json({
          error: "workflow definition is invalid",
          details: validation.errors
        });
        return;
      }

      const workflow = await deps.store.createWorkflow({
        name: payload.name.trim(),
        definition: parseWorkflowDefinition(payload.definition),
        schedule: payload.schedule ?? null,
        maxConcurrentRuns: payload.maxConcurrentRuns ?? 1
      });
      workflowCreatedCounter.inc();
      appEvents.emitEvent({ type: "workflow.created", workflowId: workflow.id });
      response.status(201).json({ workflow });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("duplicate key")) {
        response.status(409).json({ error: "workflow name already exists" });
        return;
      }
      response.status(500).json({ error: message });
    }
  });

  router.get("/workflows", requireRole(["admin", "operator", "viewer"]), async (_request, response) => {
    const workflows = await deps.store.listWorkflows();
    response.status(200).json({ workflows });
  });

  router.get("/workflows/:workflowId", requireRole(["admin", "operator", "viewer"]), async (request, response) => {
    const workflowId = String(request.params.workflowId ?? "");
    const workflow = await deps.store.getWorkflow(workflowId);
    if (!workflow) {
      response.status(404).json({ error: "workflow not found" });
      return;
    }
    response.status(200).json({ workflow });
  });

  router.post(
    "/workflows/:workflowId/trigger",
    requireRole(["admin", "operator"]),
    async (request: AuthenticatedRequest, response) => {
      try {
        const idempotencyKey = request.header("idempotency-key") ?? null;
        const triggerSource = ((request.body as { triggerSource?: TriggerSource }).triggerSource ??
          "manual") as TriggerSource;
        const accepted: TriggerSource[] = ["manual", "event", "schedule"];
        if (!accepted.includes(triggerSource)) {
          response.status(400).json({ error: "Invalid triggerSource" });
          return;
        }
        const result = await deps.orchestrator.triggerRun({
          workflowId: String(request.params.workflowId ?? ""),
          triggerSource,
          idempotencyKey
        });
        response.status(result.deduped ? 200 : 201).json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("not found")) {
          response.status(404).json({ error: message });
          return;
        }
        if (message.includes("limit")) {
          response.status(429).json({ error: message });
          return;
        }
        response.status(500).json({ error: message });
      }
    }
  );

  router.get("/runs", requireRole(["admin", "operator", "viewer"]), async (request, response) => {
    const workflowId = request.query.workflowId as string | undefined;
    const runs = await deps.store.listRuns(workflowId);
    response.status(200).json({ runs });
  });

  router.get("/runs/:runId", requireRole(["admin", "operator", "viewer"]), async (request, response) => {
    const run = await deps.store.getRun(String(request.params.runId ?? ""));
    if (!run) {
      response.status(404).json({ error: "run not found" });
      return;
    }
    response.status(200).json({ run });
  });

  router.get(
    "/runs/:runId/tasks",
    requireRole(["admin", "operator", "viewer"]),
    async (request, response) => {
      const tasks = await deps.store.listTasksForRun(String(request.params.runId ?? ""));
      response.status(200).json({ tasks });
    }
  );

  router.post("/runs/:runId/cancel", requireRole(["admin", "operator"]), async (request, response) => {
    const run = await deps.store.cancelRun(String(request.params.runId ?? ""));
    if (!run) {
      response.status(404).json({ error: "run not found" });
      return;
    }
    appEvents.emitEvent({ type: "run.updated", runId: run.id, status: run.status });
    response.status(200).json({ run });
  });

  router.get("/events", requireRole(["admin", "operator", "viewer"]), (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    const send = (event: unknown) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const listener = (event: unknown) => send(event);
    appEvents.on("event", listener);
    const ping = setInterval(() => {
      response.write(":keepalive\n\n");
    }, 15_000);

    request.on("close", () => {
      clearInterval(ping);
      appEvents.off("event", listener);
      response.end();
    });
  });

  return router;
}
