import type { Role } from "@orchestrator/shared";

const defaultDatabaseUrl = "postgres://orchestrator:orchestrator@localhost:5432/orchestrator";
const defaultRedisUrl = "redis://localhost:6379";

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAuthTokenMap(raw: string | undefined): Map<string, Role> {
  const map = new Map<string, Role>();
  const source = raw ?? "admin-token:admin,operator-token:operator,viewer-token:viewer";
  source.split(",").forEach((entry) => {
    const [token, role] = entry.split(":");
    if (!token || !role) return;
    if (role === "admin" || role === "operator" || role === "viewer") {
      map.set(token.trim(), role);
    }
  });
  return map;
}

export const config = {
  apiPort: parseInteger(process.env.API_PORT, 8080),
  metricsPort: parseInteger(process.env.METRICS_PORT, 8080),
  databaseUrl: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  redisUrl: process.env.REDIS_URL ?? defaultRedisUrl,
  requestPerMinute: parseInteger(process.env.REQUESTS_PER_MINUTE, 300),
  maxBodyBytes: parseInteger(process.env.MAX_BODY_BYTES, 1024 * 1024),
  globalActiveRunLimit: parseInteger(process.env.GLOBAL_ACTIVE_RUN_LIMIT, 200),
  leaseMs: parseInteger(process.env.LEASE_MS, 30000),
  heartbeatMs: parseInteger(process.env.HEARTBEAT_MS, 5000),
  reaperIntervalMs: parseInteger(process.env.REAPER_INTERVAL_MS, 10000),
  delayedPumpIntervalMs: parseInteger(process.env.DELAYED_PUMP_INTERVAL_MS, 2000),
  tokenMap: parseAuthTokenMap(process.env.AUTH_TOKENS)
};

export type AppConfig = typeof config;
