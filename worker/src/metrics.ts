import http from "node:http";
import client from "prom-client";

client.collectDefaultMetrics();

export const taskExecutionCounter = new client.Counter({
  name: "worker_task_execution_total",
  help: "Task execution outcomes.",
  labelNames: ["status"] as const
});

export const taskExecutionLatency = new client.Histogram({
  name: "worker_task_execution_seconds",
  help: "Task execution latency in seconds.",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30]
});

export function startMetricsServer(port: number): http.Server {
  const server = http.createServer(async (request, response) => {
    if (request.url !== "/metrics") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    const body = await client.register.metrics();
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/plain");
    response.end(body);
  });
  server.listen(port, () => {
    console.log(`worker metrics listening on ${port}`);
  });
  return server;
}
