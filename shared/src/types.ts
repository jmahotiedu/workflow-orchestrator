export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "dead_letter"
  | "cancelled";

export type TriggerSource = "manual" | "schedule" | "event";

export type Role = "admin" | "operator" | "viewer";

export interface WorkflowTaskDefinition {
  id: string;
  name: string;
  kind: "noop" | "flaky";
  dependsOn?: string[];
  config?: Record<string, unknown>;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface WorkflowDefinition {
  version: number;
  tasks: WorkflowTaskDefinition[];
}

export interface WorkflowRecord {
  id: string;
  name: string;
  definition: WorkflowDefinition;
  schedule: string | null;
  maxConcurrentRuns: number;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  status: RunStatus;
  triggerSource: TriggerSource;
  idempotencyKey: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface TaskRecord {
  id: string;
  runId: string;
  workflowId: string;
  nodeId: string;
  status: TaskStatus;
  attemptCount: number;
  maxAttempts: number;
  dependsOn: string[];
  remainingDeps: number;
  payload: Record<string, unknown>;
  workerId: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskAttemptRecord {
  id: string;
  taskId: string;
  attemptNo: number;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
