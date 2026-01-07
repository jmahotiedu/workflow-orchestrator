import type { TriggerSource, WorkflowDefinition } from "@orchestrator/shared";

export interface CreateWorkflowInput {
  name: string;
  definition: WorkflowDefinition;
  schedule?: string | null;
  maxConcurrentRuns?: number;
}

export interface CreateRunInput {
  workflowId: string;
  triggerSource: TriggerSource;
  idempotencyKey?: string | null;
}

export interface TaskMessage {
  taskId: string;
  runId: string;
  workflowId: string;
}

export interface EnqueueCandidate extends TaskMessage {
  nextAttemptAt: string;
}
