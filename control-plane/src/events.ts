import { EventEmitter } from "node:events";

export type ControlPlaneEvent =
  | { type: "workflow.created"; workflowId: string }
  | { type: "run.created"; runId: string; workflowId: string }
  | { type: "run.updated"; runId: string; status: string }
  | { type: "task.updated"; taskId: string; runId: string; status: string };

class AppEvents extends EventEmitter {
  emitEvent(event: ControlPlaneEvent): void {
    this.emit("event", event);
  }
}

export const appEvents = new AppEvents();
