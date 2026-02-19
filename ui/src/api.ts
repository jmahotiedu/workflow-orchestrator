export type Workflow = {
  id: string;
  name: string;
  schedule: string | null;
  maxConcurrentRuns: number;
};

export type Run = {
  id: string;
  workflowId: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type Task = {
  id: string;
  nodeId: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export function listWorkflows(token: string): Promise<{ workflows: Workflow[] }> {
  return request("/workflows", token);
}

export function listRuns(token: string, workflowId?: string): Promise<{ runs: Run[] }> {
  const query = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : "";
  return request(`/runs${query}`, token);
}

export function listTasksForRun(token: string, runId: string): Promise<{ tasks: Task[] }> {
  return request(`/runs/${runId}/tasks`, token);
}

export function cancelRun(token: string, runId: string): Promise<{ run: Run }> {
  return request(`/runs/${runId}/cancel`, token, { method: "POST" });
}

export function connectEvents(token: string, onEvent: (payload: unknown) => void): EventSource {
  const source = new EventSource(`${API_BASE}/events?token=${encodeURIComponent(token)}`, {
    withCredentials: false
  } as EventSourceInit);
  source.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch {
      onEvent(event.data);
    }
  };
  source.onerror = () => {
    source.close();
  };
  return source;
}
