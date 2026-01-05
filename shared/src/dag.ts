import type { ValidationResult, WorkflowDefinition } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateWorkflowDefinition(input: unknown): ValidationResult {
  const errors: ValidationResult["errors"] = [];

  if (!isObject(input)) {
    return {
      valid: false,
      errors: [{ path: "root", message: "Workflow definition must be an object." }]
    };
  }

  const version = input.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version <= 0) {
    errors.push({ path: "version", message: "Version must be a positive integer." });
  }

  const tasks = input.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    errors.push({ path: "tasks", message: "Tasks must be a non-empty array." });
    return { valid: false, errors };
  }

  const ids = new Set<string>();
  const edgeMap = new Map<string, string[]>();

  tasks.forEach((task, index) => {
    if (!isObject(task)) {
      errors.push({ path: `tasks[${index}]`, message: "Task must be an object." });
      return;
    }
    const id = task.id;
    const name = task.name;
    const kind = task.kind;
    const dependsOn = task.dependsOn;

    if (typeof id !== "string" || id.length === 0) {
      errors.push({ path: `tasks[${index}].id`, message: "Task id is required." });
      return;
    }
    if (ids.has(id)) {
      errors.push({ path: `tasks[${index}].id`, message: `Duplicate task id '${id}'.` });
      return;
    }
    ids.add(id);

    if (typeof name !== "string" || name.length === 0) {
      errors.push({ path: `tasks[${index}].name`, message: "Task name is required." });
    }
    if (kind !== "noop" && kind !== "flaky") {
      errors.push({
        path: `tasks[${index}].kind`,
        message: "Task kind must be either 'noop' or 'flaky'."
      });
    }

    if (dependsOn !== undefined && !Array.isArray(dependsOn)) {
      errors.push({
        path: `tasks[${index}].dependsOn`,
        message: "dependsOn must be an array of task ids."
      });
    }

    edgeMap.set(id, (Array.isArray(dependsOn) ? dependsOn : []).map((dep) => String(dep)));
  });

  for (const [node, deps] of edgeMap.entries()) {
    deps.forEach((dep, index) => {
      if (!ids.has(dep)) {
        errors.push({
          path: `task(${node}).dependsOn[${index}]`,
          message: `Unknown dependency '${dep}'.`
        });
      }
      if (dep === node) {
        errors.push({
          path: `task(${node}).dependsOn[${index}]`,
          message: "Task cannot depend on itself."
        });
      }
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  if (hasCycle(edgeMap)) {
    errors.push({ path: "tasks", message: "Task graph must be acyclic." });
  }

  return { valid: errors.length === 0, errors };
}

function hasCycle(edges: Map<string, string[]>): boolean {
  const inDegree = new Map<string, number>();
  const reverse = new Map<string, string[]>();

  for (const [node, deps] of edges.entries()) {
    inDegree.set(node, deps.length);
    deps.forEach((dep) => {
      const list = reverse.get(dep) ?? [];
      list.push(node);
      reverse.set(dep, list);
    });
  }

  const queue: string[] = [];
  for (const [node, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(node);
  }

  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    const dependents = reverse.get(current) ?? [];
    dependents.forEach((dependent) => {
      const nextDegree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, nextDegree);
      if (nextDegree === 0) queue.push(dependent);
    });
  }

  return visited !== edges.size;
}

export function parseWorkflowDefinition(input: unknown): WorkflowDefinition {
  const result = validateWorkflowDefinition(input);
  if (!result.valid) {
    const message = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`Invalid workflow definition: ${message}`);
  }
  return input as WorkflowDefinition;
}
