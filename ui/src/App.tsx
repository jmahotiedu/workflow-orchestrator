import { useEffect, useMemo, useState } from "react";
import {
  cancelRun,
  connectEvents,
  createWorkflow,
  listRuns,
  listTasksForRun,
  listWorkflows,
  triggerWorkflow,
  type Run,
  type Task,
  type Workflow,
  type WorkflowDefinition
} from "./api.js";
import { useAuthToken } from "./auth/useAuthToken.js";
import "./styles.css";

const DEMO_WORKFLOW_NAME = "demo-live-workflow";
const DEFAULT_WORKFLOW_DEFINITION = `{
  "version": 1,
  "tasks": [
    { "id": "a", "name": "start", "kind": "noop", "config": { "durationMs": 25 } },
    { "id": "b", "name": "fanout-1", "kind": "flaky", "dependsOn": ["a"], "config": { "durationMs": 30, "failUntilAttempt": 1 } },
    { "id": "c", "name": "fanout-2", "kind": "noop", "dependsOn": ["a"], "config": { "durationMs": 30 } },
    { "id": "d", "name": "join", "kind": "noop", "dependsOn": ["b", "c"], "config": { "durationMs": 20 } }
  ]
}`;

function parseWorkflowDefinition(input: string): WorkflowDefinition {
  const parsed = JSON.parse(input) as WorkflowDefinition;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Definition JSON must be an object.");
  }
  if (!Number.isInteger(parsed.version) || parsed.version <= 0) {
    throw new Error("Definition 'version' must be a positive integer.");
  }
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error("Definition 'tasks' must be a non-empty array.");
  }
  return parsed;
}

function formatError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function App() {
  const [token, setToken] = useAuthToken();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [workflowName, setWorkflowName] = useState(DEMO_WORKFLOW_NAME);
  const [workflowSchedule, setWorkflowSchedule] = useState("");
  const [maxConcurrentRuns, setMaxConcurrentRuns] = useState("3");
  const [workflowDefinitionInput, setWorkflowDefinitionInput] = useState(DEFAULT_WORKFLOW_DEFINITION);

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;

  const filteredRuns = useMemo(
    () =>
      runs.filter((run) => {
        if (workflowFilter !== "all" && run.workflowId !== workflowFilter) return false;
        if (statusFilter !== "all" && run.status !== statusFilter) return false;
        if (!search.trim()) return true;
        const needle = search.trim().toLowerCase();
        return run.id.toLowerCase().includes(needle) || run.workflowId.toLowerCase().includes(needle);
      }),
    [runs, search, statusFilter, workflowFilter]
  );

  async function refresh(): Promise<void> {
    if (!token) return;
    try {
      setLoading(true);
      setError(null);
      const [workflowResponse, runResponse] = await Promise.all([listWorkflows(token), listRuns(token)]);
      setWorkflows(workflowResponse.workflows);
      setRuns(runResponse.runs);
      if (selectedRunId) {
        const taskResponse = await listTasksForRun(token, selectedRunId);
        setTasks(taskResponse.tasks);
      }
    } catch (err) {
      setError(formatError(err, "Unable to refresh dashboard"));
    } finally {
      setLoading(false);
    }
  }

  async function selectRun(runId: string): Promise<void> {
    if (!token) return;
    setSelectedRunId(runId);
    try {
      const taskResponse = await listTasksForRun(token, runId);
      setTasks(taskResponse.tasks);
    } catch (err) {
      setError(formatError(err, "Failed to fetch run tasks"));
    }
  }

  async function cancelSelectedRun(): Promise<void> {
    if (!token || !selectedRunId) return;
    try {
      await cancelRun(token, selectedRunId);
      await refresh();
    } catch (err) {
      setError(formatError(err, "Failed to cancel run"));
    }
  }

  async function onCreateWorkflow(): Promise<void> {
    if (!token) return;
    try {
      setError(null);
      const definition = parseWorkflowDefinition(workflowDefinitionInput);
      const maxConcurrent = Number.parseInt(maxConcurrentRuns, 10);
      const payload = {
        name: workflowName.trim(),
        definition,
        schedule: workflowSchedule.trim() ? workflowSchedule.trim() : null,
        maxConcurrentRuns: Number.isInteger(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 1
      };
      if (!payload.name) {
        throw new Error("Workflow name is required.");
      }
      await createWorkflow(token, payload);
      await refresh();
    } catch (err) {
      setError(formatError(err, "Failed to create workflow"));
    }
  }

  async function onTriggerWorkflow(workflowId: string): Promise<void> {
    if (!token) return;
    try {
      setError(null);
      await triggerWorkflow(token, workflowId, "manual");
      await refresh();
    } catch (err) {
      setError(formatError(err, "Failed to trigger workflow"));
    }
  }

  async function onSeedDemoWorkflow(): Promise<void> {
    if (!token) return;
    try {
      setError(null);
      let workflow = workflows.find((item) => item.name === DEMO_WORKFLOW_NAME);
      if (!workflow) {
        const created = await createWorkflow(token, {
          name: DEMO_WORKFLOW_NAME,
          definition: parseWorkflowDefinition(DEFAULT_WORKFLOW_DEFINITION),
          maxConcurrentRuns: 4
        });
        workflow = created.workflow;
      }
      await triggerWorkflow(token, workflow.id, "manual");
      await refresh();
    } catch (err) {
      setError(formatError(err, "Failed to seed demo workflow"));
    }
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const source = connectEvents(token, () => {
      refresh().catch(() => undefined);
    });
    return () => source.close();
  }, [token, selectedRunId]);

  return (
    <main className="page">
      <section className="panel full-width">
        <h1>Workflow Orchestrator</h1>
        <p>Create workflows, trigger runs, and inspect task retries from a single control plane.</p>
        <label>
          API Token:
          <input placeholder="admin-token" value={token} onChange={(event) => setToken(event.target.value)} />
        </label>
        <div className="row">
          <button onClick={() => refresh().catch(() => undefined)} disabled={!token || loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button onClick={() => onSeedDemoWorkflow().catch(() => undefined)} disabled={!token || loading}>
            Seed Demo Workflow
          </button>
          <span>{workflows.length} workflows</span>
          <span>{runs.length} runs</span>
        </div>
        {error ? <pre className="error">{error}</pre> : null}
      </section>

      <section className="panel">
        <h2>Create Workflow</h2>
        <label>
          Name
          <input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} />
        </label>
        <label>
          Cron Schedule (optional)
          <input
            placeholder="*/5 * * * *"
            value={workflowSchedule}
            onChange={(event) => setWorkflowSchedule(event.target.value)}
          />
        </label>
        <label>
          Max Concurrent Runs
          <input
            type="number"
            min={1}
            value={maxConcurrentRuns}
            onChange={(event) => setMaxConcurrentRuns(event.target.value)}
          />
        </label>
        <label>
          Definition JSON
          <textarea
            rows={14}
            value={workflowDefinitionInput}
            onChange={(event) => setWorkflowDefinitionInput(event.target.value)}
          />
        </label>
        <button onClick={() => onCreateWorkflow().catch(() => undefined)} disabled={!token || loading}>
          Create Workflow
        </button>
      </section>

      <section className="panel">
        <h2>Workflows</h2>
        {workflows.length === 0 ? (
          <p className="muted">No workflows found. Create one or use "Seed Demo Workflow".</p>
        ) : null}
        <ul className="list">
          {workflows.map((workflow) => (
            <li key={workflow.id}>
              <button className="item">
                <strong>{workflow.name}</strong>
                <span>{workflow.id}</span>
                <small>
                  schedule: {workflow.schedule ?? "manual"} | max concurrent: {workflow.maxConcurrentRuns}
                </small>
              </button>
              <button onClick={() => onTriggerWorkflow(workflow.id).catch(() => undefined)} disabled={!token || loading}>
                Trigger Run
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Runs</h2>
        <div className="filters">
          <input
            placeholder="Search run or workflow id"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={workflowFilter} onChange={(event) => setWorkflowFilter(event.target.value)}>
            <option value="all">All workflows</option>
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="succeeded">Succeeded</option>
            <option value="cancelled">Cancelled</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <ul className="list">
          {filteredRuns.map((run) => (
            <li key={run.id}>
              <button
                className={`item ${run.id === selectedRunId ? "active" : ""}`}
                onClick={() => {
                  selectRun(run.id).catch(() => undefined);
                }}
              >
                <strong>{run.id.slice(0, 8)}</strong>
                <span>{run.status}</span>
                <small>{new Date(run.createdAt).toLocaleString()}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Run Details</h2>
        {selectedRun ? (
          <>
            <div className="row">
              <span>Run: {selectedRun.id}</span>
              <span>Status: {selectedRun.status}</span>
              <button onClick={() => cancelSelectedRun().catch(() => undefined)}>Cancel Run</button>
            </div>
            <h3>Tasks</h3>
            <table>
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Status</th>
                  <th>Attempt</th>
                  <th>Last Error</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.nodeId}</td>
                    <td>{task.status}</td>
                    <td>
                      {task.attemptCount}/{task.maxAttempts}
                    </td>
                    <td>{task.lastError ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p>Select a run to inspect timeline details and task attempts.</p>
        )}
      </section>
    </main>
  );
}

export default App;
