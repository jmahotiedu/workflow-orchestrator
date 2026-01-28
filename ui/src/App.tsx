import { useEffect, useMemo, useState } from "react";
import {
  cancelRun,
  connectEvents,
  listRuns,
  listTasksForRun,
  listWorkflows,
  type Run,
  type Task,
  type Workflow
} from "./api.js";
import { useAuthToken } from "./auth/useAuthToken.js";
import "./styles.css";

export function App() {
  const [token, setToken] = useAuthToken();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;

  const filteredRuns = useMemo(
    () =>
      runs.filter((run) => {
        if (statusFilter !== "all" && run.status !== statusFilter) return false;
        if (!search.trim()) return true;
        return run.id.toLowerCase().includes(search.trim().toLowerCase());
      }),
    [runs, search, statusFilter]
  );

  async function refresh(): Promise<void> {
    if (!token) return;
    try {
      setLoading(true);
      setError(null);
      const [workflowResponse, runResponse] = await Promise.all([
        listWorkflows(token),
        listRuns(token)
      ]);
      setWorkflows(workflowResponse.workflows);
      setRuns(runResponse.runs);
      if (selectedRunId) {
        const taskResponse = await listTasksForRun(token, selectedRunId);
        setTasks(taskResponse.tasks);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelSelectedRun(): Promise<void> {
    if (!token || !selectedRunId) return;
    try {
      await cancelRun(token, selectedRunId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      <section className="panel">
        <h1>Workflow Orchestrator</h1>
        <p>Control-plane dashboard for workflows, runs, retries, and failures.</p>
        <label>
          API Token:
          <input
            placeholder="admin-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <div className="row">
          <button onClick={() => refresh().catch(() => undefined)} disabled={!token || loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <span>{workflows.length} workflows</span>
          <span>{runs.length} runs</span>
        </div>
        {error ? <pre className="error">{error}</pre> : null}
      </section>

      <section className="panel">
        <h2>Runs</h2>
        <div className="filters">
          <input
            placeholder="Search run id"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="succeeded">Succeeded</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <ul className="list">
          {filteredRuns.map((run) => (
            <li key={run.id}>
              <button
                className={run.id === selectedRunId ? "active" : ""}
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
