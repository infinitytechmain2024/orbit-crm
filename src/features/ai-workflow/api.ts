import type {
  AgentRun,
  NewWorkflowTask,
  TaskDependency,
  WorkflowOverview,
  WorkflowRun,
  WorkflowTask,
} from "./types";

type ApiErrorPayload = { detail?: string; error?: string };

const backendErrorMessages: Record<number, string> = {
  502: "Сервер отвечает с ошибкой. Попробуйте еще раз через минуту.",
  503: "Сервис временно недоступен. Администратор был уведомлен.",
};

const isTransientError = (status: number) => status === 502 || status === 503;

async function workflowRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  const response = await fetch(`/api/backend/api/ai-workflow/${path.replace(/^\//, "")}`, {
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

    const status = response.status;
    let userMessage = backendErrorMessages[status] || `Ошибка ${status}: ${payload.detail || payload.error || "неизвестная ошибка"}`;

    // Translate specific proxy messages to user-friendly Russian
    if (payload.detail) {
      const lower = payload.detail.toLowerCase();
      if (lower.includes("waking up") || lower.includes("засыпает")) {
        userMessage = "Backend просыпается, подождите 1–2 минуты и попробуйте снова.";
      } else if (lower.includes("unavailable")) {
        userMessage = "Сервер временно недоступен. Попробуйте позже.";
      } else if (lower.includes("not configured")) {
        userMessage = "Ошибка конфигурации сервиса. Администратору нужна помощь.";
      }
    }

    throw new Error(userMessage);
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
  return workflowRequest<{ task: WorkflowTask; queued_for_execution: boolean }>(
    accessToken,
    "tasks",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
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

export function controlWorkflowTask(
  accessToken: string,
  taskId: string,
  organizationId: string,
  action: "pause" | "resume" | "retry" | "cancel",
) {
  return workflowRequest<{ task: WorkflowTask; action: string }>(
    accessToken,
    `tasks/${taskId}/${action}`,
    { method: "POST", body: JSON.stringify({ organization_id: organizationId }) },
  );
}

export function fetchWorkflowPlan(accessToken: string, taskId: string, organizationId: string) {
  const query = new URLSearchParams({ organization_id: organizationId });
  return workflowRequest<{
    task: WorkflowTask;
    workflow_run: WorkflowRun;
    subtasks: WorkflowTask[];
    dependencies: TaskDependency[];
    agent_runs: AgentRun[];
    agent_messages: Array<Record<string, unknown>>;
  }>(accessToken, `tasks/${taskId}/plan?${query}`);
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

export function decideApprovalRequest(
  accessToken: string,
  approvalId: string,
  organizationId: string,
  decision: "approve" | "reject" | "request_changes",
  decisionComment?: string,
) {
  return workflowRequest<{ approval: Record<string, unknown> }>(
    accessToken,
    `approvals/${approvalId}/decision`,
    {
      method: "POST",
      body: JSON.stringify({
        organization_id: organizationId,
        decision,
        decision_comment: decisionComment || null,
      }),
    },
  );
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

export function transcribeWorkflowVoice(accessToken: string, organizationId: string, audio: Blob) {
  const formData = new FormData();
  formData.append("organization_id", organizationId);
  formData.append("audio", audio, "workflow-task.webm");
  return workflowRequest<{ transcript: string }>(accessToken, "voice/transcribe", {
    method: "POST",
    body: formData,
  });
}
