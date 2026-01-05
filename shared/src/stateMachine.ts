import type { RunStatus, TaskStatus } from "./types.js";

const runTransitions: Record<RunStatus, Set<RunStatus>> = {
  pending: new Set(["running", "cancelled"]),
  running: new Set(["succeeded", "failed", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set()
};

const taskTransitions: Record<TaskStatus, Set<TaskStatus>> = {
  pending: new Set(["queued", "cancelled"]),
  queued: new Set(["running", "cancelled"]),
  running: new Set(["succeeded", "failed", "pending", "dead_letter", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(["pending", "dead_letter"]),
  dead_letter: new Set(),
  cancelled: new Set()
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return runTransitions[from].has(to);
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return taskTransitions[from].has(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new Error(`Invalid run transition: ${from} -> ${to}`);
  }
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
  }
}
