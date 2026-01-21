import cors from "cors";
import express from "express";
import type { AppConfig } from "./config.js";
import { createApiRouter } from "./api/routes.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import { createRateLimiter } from "./limits/rateLimiter.js";
import { metricsSnapshot } from "./metrics/metrics.js";
import type { OrchestratorService } from "./orchestrator.js";
import type { PostgresStore } from "./store/postgresStore.js";

export function createApp(deps: {
  config: AppConfig;
  store: PostgresStore;
  orchestrator: OrchestratorService;
}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: deps.config.maxBodyBytes }));
  app.get("/api/health", (_request, response) => {
    response.status(200).json({ ok: true });
  });
  app.get("/api/metrics", async (_request, response) => {
    response.setHeader("Content-Type", "text/plain");
    response.send(await metricsSnapshot());
  });
  app.use(createRateLimiter(deps.config.requestPerMinute));
  app.use(createAuthMiddleware(deps.config.tokenMap));
  app.use("/api", createApiRouter({ store: deps.store, orchestrator: deps.orchestrator }));
  return app;
}
