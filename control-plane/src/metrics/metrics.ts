import client from "prom-client";

client.collectDefaultMetrics();

export const workflowCreatedCounter = new client.Counter({
  name: "workflow_created_total",
  help: "Number of workflows created."
});

export const runCreatedCounter = new client.Counter({
  name: "run_created_total",
  help: "Number of runs created.",
  labelNames: ["trigger_source"] as const
});

export const runStatusGauge = new client.Gauge({
  name: "runs_by_status",
  help: "Current count of runs by status.",
  labelNames: ["status"] as const
});

export const taskStatusCounter = new client.Counter({
  name: "task_status_total",
  help: "Number of task status transitions.",
  labelNames: ["status"] as const
});

export const queuePumpCounter = new client.Counter({
  name: "queue_delayed_pump_total",
  help: "Number of delayed tasks moved to active queue."
});

export const runDurationHistogram = new client.Histogram({
  name: "run_duration_seconds",
  help: "Run duration in seconds.",
  buckets: [0.1, 1, 5, 10, 30, 60, 120, 300, 600]
});

export async function metricsSnapshot(): Promise<string> {
  return client.register.metrics();
}
