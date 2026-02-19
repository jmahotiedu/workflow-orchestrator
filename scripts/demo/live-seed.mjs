const apiBase = process.env.WORKFLOW_API_BASE ?? "http://localhost:8080/api";
const token = process.env.WORKFLOW_API_TOKEN ?? "admin-token";
const workflowName = process.env.WORKFLOW_DEMO_NAME ?? "demo-live-workflow";

const demoDefinition = {
  version: 1,
  tasks: [
    { id: "a", name: "start", kind: "noop", config: { durationMs: 25 } },
    { id: "b", name: "fanout-1", kind: "flaky", dependsOn: ["a"], config: { durationMs: 30, failUntilAttempt: 1 } },
    { id: "c", name: "fanout-2", kind: "noop", dependsOn: ["a"], config: { durationMs: 30 } },
    { id: "d", name: "join", kind: "noop", dependsOn: ["b", "c"], config: { durationMs: 20 } }
  ]
};

async function request(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const listed = await request("/workflows");
  let workflow = listed.workflows.find((entry) => entry.name === workflowName);

  if (!workflow) {
    const created = await request("/workflows", {
      method: "POST",
      body: JSON.stringify({
        name: workflowName,
        definition: demoDefinition,
        maxConcurrentRuns: 4
      })
    });
    workflow = created.workflow;
  }

  const trigger = await request(`/workflows/${workflow.id}/trigger`, {
    method: "POST",
    headers: {
      "Idempotency-Key": `live-seed-${Date.now()}`
    },
    body: JSON.stringify({ triggerSource: "manual" })
  });

  const runs = await request(`/runs?workflowId=${encodeURIComponent(workflow.id)}`);
  const latestRun = runs.runs[0] ?? null;
  const tasks = latestRun ? await request(`/runs/${latestRun.id}/tasks`) : { tasks: [] };

  console.log(
    JSON.stringify(
      {
        apiBase,
        workflow: { id: workflow.id, name: workflow.name },
        triggeredRun: trigger.run?.id ?? null,
        latestRun: latestRun ? { id: latestRun.id, status: latestRun.status } : null,
        taskCount: tasks.tasks.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
