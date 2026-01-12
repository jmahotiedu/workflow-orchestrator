function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  workerId: process.env.WORKER_ID ?? `worker-${Math.random().toString(16).slice(2, 8)}`,
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://orchestrator:orchestrator@localhost:5432/orchestrator",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  leaseMs: parseInteger(process.env.LEASE_MS, 30000),
  heartbeatMs: parseInteger(process.env.HEARTBEAT_MS, 5000),
  maxBatch: parseInteger(process.env.WORKER_MAX_BATCH, 4),
  metricsPort: parseInteger(process.env.WORKER_METRICS_PORT, 8081)
};
