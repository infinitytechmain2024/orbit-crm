import type { NewWorkflowTask, WorkflowOverview, WorkflowTask } from "./types";

type ApiErrorPayload = { detail?: string; error?: string };

async function workflowRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`/api/ai-workflow/${path.replace(/^\//, "")}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      // Preserve the stable user-facing fallback below.
    }
    throw new Error(payload.detail || payload.error || `AI Workflow API: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchWorkflowOverview(
  accessToken: string,
  organizationId: string,
  projectId?: string,
) {
  const query = new URLSearchParams({ organization_id: organizationId });
  if (projectId) query.set("project_id", projectId);
  return workflowRequest<WorkflowOverview>(accessToken, `overview?${query}`);
}

export function createWorkflowTask(accessToken: string, input: NewWorkflowTask) {
  return workflowRequest<{ task: WorkflowTask; queued_for_execution: boolean }>(accessToken, "tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function patchWorkflowTask(
  accessToken: string,
  taskId: string,
  input: Record<string, unknown>,
) {
  return workflowRequest<{ task: WorkflowTask }>(accessToken, `tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function runWorkflowTask(accessToken: string, taskId: string, organizationId: string) {
  return workflowRequest<{ task: WorkflowTask; queued_for_execution: boolean }>(
    accessToken,
    `tasks/${taskId}/run`,
    { method: "POST", body: JSON.stringify({ organization_id: organizationId }) },
  );
}

export function decideWorkflowApproval(
  accessToken: string,
  taskId: string,
  organizationId: string,
  decision: "approve" | "reject",
  decisionComment?: string,
) {
  return workflowRequest<{ task: WorkflowTask }>(accessToken, `tasks/${taskId}/${decision}`, {
    method: "POST",
    body: JSON.stringify({
      organization_id: organizationId,
      decision_comment: decisionComment || null,
    }),
  });
}

export function assignWorkflowTask(
  accessToken: string,
  organizationId: string,
  taskId: string,
  agentId?: string,
  departmentId?: string,
) {
  return workflowRequest<{ task: WorkflowTask }>(accessToken, "router/assign", {
    method: "POST",
    body: JSON.stringify({
      organization_id: organizationId,
      task_id: taskId,
      agent_id: agentId || null,
      department_id: departmentId || null,
    }),
  });
}

export function transcribeWorkflowVoice(
  accessToken: string,
  organizationId: string,
  audio: Blob,
) {
  const formData = new FormData();
  formData.append("organization_id", organizationId);
  formData.append("audio", audio, "workflow-task.webm");
  return workflowRequest<{ transcript: string }>(accessToken, "voice/transcribe", {
    method: "POST",
    body: formData,
  });
}

