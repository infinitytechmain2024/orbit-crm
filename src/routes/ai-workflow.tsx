import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Crown, Loader2, RefreshCw, Shield } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/crm/AppShell";
import { useAuth } from "@/lib/auth";
import { useCrm } from "@/lib/crm-store";
import {
  assignWorkflowTask,
  controlWorkflowTask,
  createWorkflowTask,
  decideApprovalRequest,
  decideWorkflowApproval,
  patchWorkflowTask,
  runWorkflowTask,
  transcribeWorkflowVoice,
} from "@/features/ai-workflow/api";
import { AgentProfileDialog, TaskDetailDialog } from "@/features/ai-workflow/DetailDialogs";
import { RightRail } from "@/features/ai-workflow/RightRail";
import { TeamMap } from "@/features/ai-workflow/TeamMap";
import {
  CreateTaskDialog,
  RejectTaskDialog,
  VoiceTaskDialog,
} from "@/features/ai-workflow/TaskDialogs";
import { TasksTable, type TaskTab } from "@/features/ai-workflow/TasksTable";
import type {
  NewWorkflowTask,
  WorkflowAgent,
  WorkflowDepartment,
  WorkflowTask,
  WorkflowTaskStatus,
} from "@/features/ai-workflow/types";
import { useAiWorkflow } from "@/features/ai-workflow/use-ai-workflow";
import { WorkflowToolbar } from "@/features/ai-workflow/WorkflowToolbar";
import { WorkflowPlanCard } from "@/features/ai-workflow/WorkflowPlanCard";
import { WorkflowChatPanel } from "@/features/ai-workflow/WorkflowChatPanel";
import { DEMO_ORGANIZATION_ID, DEMO_USER_ID } from "@/features/ai-workflow/demo-data";
import { ApprovalGateway } from "@/features/ai-ceo/components/ApprovalGateway";
import { CeoDashboard } from "@/features/ai-ceo/components/CeoDashboard";
import { dispatchTask, assessRisk, generateChangePackage } from "@/features/ai-ceo/dispatcher";
import { createApprovalRequest } from "@/features/ai-ceo/api";
import { useBackendStatus } from "@/features/ai-workflow/use-backend-status";
import { useWorkflowProgress } from "@/features/ai-workflow/use-workflow-progress";
import { useCEOStats } from "@/features/ai-workflow/use-ceo-stats";

export const Route = createFileRoute("/ai-workflow")({
  head: () => ({
    meta: [
      { title: "AI Workflow — Orbit CRM" },
      { name: "description", content: "Единый канал работы AI-команды Orbit CRM" },
    ],
  }),
  component: AIWorkflowPage,
});

function previewRoleForTask(input: Omit<NewWorkflowTask, "organization_id">) {
  const text = `${input.title} ${input.description}`.toLocaleLowerCase();
  const actionRules: Array<[RegExp, "run" | "change"]> = [
    [/(запуск|выполнение|старт|execute|run|обработка|стартовать)/i, "run"],
    [/(создание|создай|создать|новый|добавление|добавь|обновление|изменение|апдейт)/i, "change"],
  ];
  const action = actionRules.find(([pattern]) => pattern.test(text))?.[1] ?? "change";

  const roleRules: Array<[RegExp, string]> = [
    [/(ai |ии |модел|nvidia|prompt|промпт|llm|агент)/, "AI Integrations"],
    [/(тест|qa|ci\/cd|деплой|deploy|ошиб|devops)/, "QA / DevOps"],
    [/(api|backend|бэкенд|сервер|database|баз|sql|auth|rls)/, "Backend"],
    [/(frontend|фронтенд|интерфейс|компонент|адаптив|ux|ui|в[её]рст)/, "Frontend"],
    [/(seo|семантик|мета|ключев|контент-план)/, "SEO"],
    [/(smm|соцсет|instagram|telegram|linkedin|публикац|пост)/, "SMM"],
    [/(рассыл|email|письм|сегментац)/, "Рассылка"],
    [/(парс|scrap|сбор данн|crawler)/, "Парсинг"],
    [/(лид|продаж|воронк|коммерческ|sales)/, "Sales Rep"],
    [/(аналит|kpi|метрик|отч[её]т|дашборд)/, "Data Analyst"],
    [/(вакан|кандидат|найм|рекрут)/, "Рекрутинг"],
    [/(онборд|адаптац|новый сотруд)/, "Онбординг"],
    [/(people ops|вовлеч|культура)/, "People Ops"],
    [/(стратег|позиционир|рост|бренд)/, "CMO"],
    [/(операцион|координац|регламент|процесс команды)/, "COO"],
  ];
  const role = roleRules.find(([pattern]) => pattern.test(text))?.[1] ?? "COO";

  return { role, action };
}

const RETRY_WINDOW_MS = 2 * 60_000;
const RETRY_INTERVAL_MS = 1_000;
const RETRY_MAX_ATTEMPTS = Math.ceil(RETRY_WINDOW_MS / RETRY_INTERVAL_MS);

type PendingTaskState = {
  phase: "planning" | "in_progress" | "approval" | "control";
  attempt: number;
  maxAttempts: number;
  nextRetryAt: number | null;
  deadlineAt: number;
};

function isTransientBackendError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return [
    "502",
    "503",
    "failed to fetch",
    "backend is unavailable",
    "просып",
    "waking up",
    "timeout",
  ].some((fragment) => message.includes(fragment));
}

function AIWorkflowPage() {
  const { organization } = useCrm();
  const { session } = useAuth();
  const [projectId, setProjectId] = useState("all");
  const [search, setSearch] = useState("");
  const [taskTab, setTaskTab] = useState<TaskTab>("all");
  const [departmentId, setDepartmentId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<WorkflowAgent | null>(null);
  const [selectedTask, setSelectedTask] = useState<WorkflowTask | null>(null);
  const [rejectTask, setRejectTask] = useState<WorkflowTask | null>(null);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isMutating, setMutating] = useState(false);
  const [cancelConfirmTask, setCancelConfirmTask] = useState<WorkflowTask | null>(null);
  const [pendingTasks, setPendingTasks] = useState<Record<string, PendingTaskState>>({});
  const preview =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "1";
  const accessToken = session?.access_token;
  const organizationId = preview ? DEMO_ORGANIZATION_ID : organization?.id;
  const workflow = useAiWorkflow(accessToken, organizationId, projectId, preview);
  const demoMode = preview;
  const { overview } = workflow;
  const showInitialLoading =
    !workflow.hasLoadedInitialData && !workflow.error && !workflow.isRecovering;
  // Older backend deployments returned the overview collections without the
  // optional provider diagnostics block. Keep the dashboard render-safe while
  // backend and frontend versions roll forward independently.
  const provider = overview.provider;
  const nvidiaConfigured = provider?.nvidia_configured ?? false;
  const nvidiaMissing = provider?.nvidia_missing ?? [];
  const supabaseConfigured = provider?.supabase_configured ?? true;
  const supabaseMissing = provider?.supabase_missing ?? [];
  const openclawConfigured = provider?.openclaw_configured ?? false;
  const openclawDetail = provider?.openclaw_configured_detail ?? {
    configured: openclawConfigured,
    connected: openclawConfigured,
    missing: [] as string[],
  };
  const openclawConnected = openclawDetail.connected ?? openclawConfigured;

  // New hooks for live backend status and progress
  const backendStatus = useBackendStatus();
  const workflowProgress = useWorkflowProgress(overview.tasks);
  const ceoStats = useCEOStats(overview.tasks);

  const initialProjectId = projectId === "all" ? (overview.projects[0]?.id ?? "") : projectId;
  const projectById = useMemo(
    () => new Map(overview.projects.map((project) => [project.id, project])),
    [overview.projects],
  );
  const departmentById = useMemo(
    () => new Map(overview.departments.map((department) => [department.id, department])),
    [overview.departments],
  );
  const agentById = useMemo(
    () => new Map(overview.agents.map((agent) => [agent.id, agent])),
    [overview.agents],
  );

  const mapTasks = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return overview.tasks;
    return overview.tasks.filter((task) => {
      const project = task.project_id ? (projectById.get(task.project_id)?.name ?? "") : "";
      const agent = task.agent_id ? (agentById.get(task.agent_id)?.role ?? "") : "";
      return `${task.title} ${task.description} ${project} ${agent}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [agentById, overview.tasks, projectById, search]);

  function notify(message: string) {
    setMutationMessage(message);
    window.setTimeout(() => setMutationMessage(null), 2800);
  }

  async function perform(action: () => Promise<void>, success: string) {
    setMutating(true);
    setMutationError(null);
    try {
      await action();
      notify(success);
    } catch (unknownError) {
      setMutationError(
        unknownError instanceof Error ? unknownError.message : "Не удалось выполнить действие",
      );
      throw unknownError;
    } finally {
      setMutating(false);
    }
  }

  function clearPendingTask(taskId: string) {
    setPendingTasks((current) => {
      if (!(taskId in current)) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }

  function setPendingTask(taskId: string, state: PendingTaskState) {
    setPendingTasks((current) => ({ ...current, [taskId]: state }));
  }

  async function runWithTransientRetry(
    task: WorkflowTask,
    mutateLocal: (attempt: number) => void,
    commit: () => Promise<void>,
    successMessage: string,
    failureMessage: string,
    phase: PendingTaskState["phase"],
  ) {
    const deadline = Date.now() + RETRY_WINDOW_MS;
    let attempt = 0;

    const tryCommit = async (): Promise<void> => {
      attempt += 1;
      const nextRetryAt = attempt < RETRY_MAX_ATTEMPTS ? Date.now() + RETRY_INTERVAL_MS : null;
      setPendingTask(task.id, {
        phase,
        attempt,
        maxAttempts: RETRY_MAX_ATTEMPTS,
        nextRetryAt,
        deadlineAt: deadline,
      });
      mutateLocal(attempt);
      try {
        await commit();
        clearPendingTask(task.id);
        notify(successMessage);
      } catch (error) {
        if (Date.now() < deadline && isTransientBackendError(error)) {
          window.setTimeout(() => void tryCommit(), RETRY_INTERVAL_MS);
          return;
        }
        clearPendingTask(task.id);
        throw error;
      }
    };

    try {
      await tryCommit();
    } catch (error) {
      workflow.updateLocalTask(task.id, {
        status: "blocked",
        blocker_reason: error instanceof Error ? error.message : failureMessage,
        updated_at: new Date().toISOString(),
        input_data: {
          ...task.input_data,
          run_stage: "failed",
          run_error: error instanceof Error ? error.message : failureMessage,
        },
      });
      setMutationError(error instanceof Error ? error.message : failureMessage);
      toast.error(failureMessage, {
        description: error instanceof Error ? error.message : "Попробуйте еще раз позже",
      });
    }
  }

  async function handleCreate(input: Omit<NewWorkflowTask, "organization_id">) {
    if (!organizationId) throw new Error("Сессия ещё загружается");
    const { role, action } = previewRoleForTask(input);

    // CEO Dispatcher: Classify task and assess risk
    const fullText = `${input.title} ${input.description}`;
    const dispatchResult = dispatchTask(fullText, {
      currentProject: input.project_id ?? undefined,
      allowDestructive: false,
      ...(session?.user?.id ? { userId: session.user.id } : {}),
    });

    const riskLevel = assessRisk(fullText);
    const requiresApproval = riskLevel === "critical" || riskLevel === "high";

    if (demoMode) {
      const agent = overview.agents.find((item) => item.role === role);
      const task: WorkflowTask = {
        id: crypto.randomUUID(),
        organization_id: organizationId,
        project_id: input.project_id,
        department_id: agent?.department_id ?? null,
        agent_id: agent?.id ?? null,
        parent_task_id: null,
        title: input.title,
        description: input.description,
        status: requiresApproval ? "approval_required" : "queued",
        priority: input.priority,
        due_at: input.due_at,
        input_data: {
          preview: true,
          auto_assign: input.auto_assign,
          action_type: action,
          risk_level: riskLevel,
          requires_approval: requiresApproval,
        },
        result: null,
        current_model: "nvidia/capability-router",
        created_by: DEMO_USER_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        action_type: action,
        risk_level: riskLevel,
        approval_required: requiresApproval,
      };

      // If approval required, create approval request
      if (requiresApproval) {
        const changePackage = generateChangePackage(
          {
            title: input.title,
            description: input.description,
            actionType: action,
            projectGuess: dispatchResult.taskId ? "Orbit CRM" : null,
          },
          riskLevel,
        );

        await createApprovalRequest({
          taskId: task.id,
          action: action === "run" ? "Execute operational task" : "Create/modify code",
          reason: `Risk level: ${riskLevel}. Task requires CEO approval before execution.`,
          riskLevel,
          changeSummary: changePackage,
        });

        notify(`Задача создана и отправлена на CEO-аппрув (риск: ${riskLevel})`);
      } else {
        workflow.prependTask(task, `AI Router назначил задачу агенту ${agent?.role ?? "COO"}.`);
        notify("Demo-задача создана и назначена AI Router");
      }
      return;
    }
    if (!accessToken) throw new Error("Сессия ещё загружается");
    await perform(
      async () => {
        const response = await createWorkflowTask(accessToken, {
          organization_id: organizationId,
          ...input,
        });

        // If approval required, create approval request
        if (requiresApproval) {
          const changePackage = generateChangePackage(
            {
              title: input.title,
              description: input.description,
              actionType: action,
              projectGuess: dispatchResult.taskId ? "Orbit CRM" : null,
            },
            riskLevel,
          );

          await createApprovalRequest({
            taskId: response.task.id,
            action: action === "run" ? "Execute operational task" : "Create/modify code",
            reason: `Risk level: ${riskLevel}. Task requires CEO approval before execution.`,
            riskLevel,
            changeSummary: changePackage,
          });
        }

        workflow.prependTask(
          response.task,
          requiresApproval
            ? `Задача создана и отправлена на CEO-аппрув (риск: ${riskLevel})`
            : "AI Router назначил исполнителя и поставил задачу в очередь.",
        );
        await workflow.refresh(true);
      },
      requiresApproval
        ? "Задача создана и отправлена на CEO-аппрув"
        : "Задача создана и передана AI Router",
    );
  }

  async function handlePatch(task: WorkflowTask, patch: Record<string, unknown>, success: string) {
    if (!organizationId) return;
    if (demoMode) {
      workflow.updateLocalTask(task.id, patch as Partial<WorkflowTask>);
      notify(success);
      return;
    }
    if (!accessToken) return;
    await perform(async () => {
      const response = await patchWorkflowTask(accessToken, task.id, {
        organization_id: organizationId,
        ...patch,
      });
      workflow.prependTask(response.task);
      await workflow.refresh(true);
    }, success);
  }

  async function handleAssign(task: WorkflowTask, agentId: string) {
    if (!organizationId || !agentId) return;
    if (demoMode) {
      const agent = overview.agents.find((item) => item.id === agentId);
      workflow.updateLocalTask(task.id, {
        agent_id: agentId,
        department_id: agent?.department_id ?? null,
      });
      notify("Агент назначен");
      return;
    }
    if (!accessToken) return;
    await perform(async () => {
      const response = await assignWorkflowTask(accessToken, organizationId, task.id, agentId);
      workflow.prependTask(response.task);
      await workflow.refresh(true);
    }, "Агент назначен");
  }

  async function handleRun(task: WorkflowTask) {
    if (!organizationId) return;
    if (demoMode) {
      workflow.updateLocalTask(task.id, {
        status: "in_progress",
        updated_at: new Date().toISOString(),
      });
      notify("Demo-задача запущена");
      return;
    }
    if (!accessToken) return;
    workflow.updateLocalTask(task.id, {
      status: "planning",
      updated_at: new Date().toISOString(),
      input_data: {
        ...task.input_data,
        run_stage: "preparing",
        run_started_at: new Date().toISOString(),
      },
    });
    await runWithTransientRetry(
      task,
      (attempt) =>
        workflow.updateLocalTask(task.id, {
          status: attempt === 1 ? "planning" : "in_progress",
          updated_at: new Date().toISOString(),
          input_data: {
            ...task.input_data,
            run_stage: attempt === 1 ? "preparing" : "retrying",
            retry_count: attempt,
          },
        }),
      async () => {
        await runWorkflowTask(accessToken, task.id, organizationId);
        await workflow.refresh(true);
      },
      "Задача запущена",
      "Не удалось запустить задачу",
      "planning",
    );
  }

  async function handleControl(
    task: WorkflowTask,
    action: "pause" | "resume" | "retry" | "cancel",
  ) {
    if (!organizationId) return;
    const statusByAction: Record<typeof action, WorkflowTaskStatus> = {
      pause: "paused",
      resume: "in_progress",
      retry: "queued",
      cancel: "cancelled",
    };
    const successByAction = {
      pause: "Workflow приостановлен",
      resume: "Workflow возобновлён",
      retry: "Этап перезапущен",
      cancel: "Workflow отменён",
    };
    if (demoMode) {
      workflow.updateLocalTask(task.id, {
        status: statusByAction[action],
        updated_at: new Date().toISOString(),
      });
      notify(successByAction[action]);
      return;
    }
    if (!accessToken) return;
    await runWithTransientRetry(
      task,
      () =>
        workflow.updateLocalTask(task.id, {
          status: statusByAction[action],
          updated_at: new Date().toISOString(),
          input_data: {
            ...task.input_data,
            control_stage: action,
          },
        }),
      async () => {
        const response = await controlWorkflowTask(accessToken, task.id, organizationId, action);
        workflow.prependTask(response.task);
        await workflow.refresh(true);
      },
      successByAction[action],
      `Не удалось выполнить действие "${action}"`,
      "control",
    );
  }

  async function handleApprove(task: WorkflowTask) {
    if (!organizationId) return;
    if (demoMode) {
      workflow.updateLocalTask(task.id, { status: "done", updated_at: new Date().toISOString() });
      workflow.removeApprovalRequest(task.id);
      notify("CEO утвердил результат");
      return;
    }
    if (!accessToken) return;
    workflow.updateLocalTask(task.id, {
      status: "in_progress",
      updated_at: new Date().toISOString(),
    });
    workflow.removeApprovalRequest(task.id);
    setSelectedTask(null);
    await runWithTransientRetry(
      task,
      () =>
        workflow.updateLocalTask(task.id, {
          status: "in_progress",
          updated_at: new Date().toISOString(),
          input_data: {
            ...task.input_data,
            approval_stage: "sending",
          },
        }),
      async () => {
        await decideWorkflowApproval(accessToken, task.id, organizationId, "approve");
        await workflow.refresh(true);
      },
      "CEO утвердил результат",
      "Не удалось применить approval",
      "approval",
    );
  }

  async function handleReject(comment: string, decision: "request_changes" | "reject") {
    if (!organizationId || !rejectTask) return;
    const task = rejectTask;
    if (demoMode) {
      workflow.updateLocalTask(task.id, {
        status: decision === "request_changes" ? "revisions_requested" : "cancelled",
        updated_at: new Date().toISOString(),
        input_data: { ...task.input_data, decision_comment: comment },
      });
      workflow.removeApprovalRequest(task.id);
      setRejectTask(null);
      notify(
        decision === "request_changes" ? "Запрошены изменения" : "Критическое действие отклонено",
      );
      return;
    }
    if (!accessToken) return;
    workflow.updateLocalTask(task.id, {
      status: decision === "request_changes" ? "revisions_requested" : "cancelled",
      updated_at: new Date().toISOString(),
      input_data: { ...task.input_data, decision_comment: comment },
    });
    workflow.removeApprovalRequest(task.id);
    setRejectTask(null);
    setSelectedTask(null);
    await perform(
      async () => {
        const approval = overview.approval_requests.find((item) => item.task_id === task.id);
        if (!approval) throw new Error("Запрос на подтверждение не найден");
        await decideApprovalRequest(accessToken, approval.id, organizationId, decision, comment);
        await workflow.refresh(true);
      },
      decision === "request_changes" ? "Запрошены изменения" : "Критическое действие отклонено",
    );
  }

  function selectDepartment(department: WorkflowDepartment) {
    setDepartmentId((current) => (current === department.id ? "" : department.id));
    setTaskTab("all");
    window.setTimeout(
      () =>
        document
          .getElementById("ai-workflow-tasks")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
  }

  const toolbar = (
    <WorkflowToolbar
      projects={overview.projects}
      projectId={projectId}
      search={search}
      onProjectChange={(value) => {
        setProjectId(value);
        setDepartmentId("");
      }}
      onSearchChange={setSearch}
      onCreate={() => setCreateOpen(true)}
      onVoice={() => setVoiceOpen(true)}
      onChat={() => setChatOpen(true)}
    />
  );

  return (
    <AppShell
      title="AI Workflow"
      subtitle="Единый канал работы AI-команды"
      headerActions={toolbar}
      hideAssistant
      mainClassName="ai-workflow-page !px-3 !py-4 sm:!px-5 sm:!py-5"
    >
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-xs backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-primary">
              {preview ? "Preview" : workflow.isRecovering ? "Warming up" : "Live backend"}
            </span>
            <span className="text-muted-foreground">
              {preview
                ? "URL ?preview=1 включает статичный демо-рендер без живого backend."
                : workflow.isRecovering
                  ? "Backend сейчас просыпается или отвечает с задержкой. UI сохраняет состояние и повторяет попытки автоматически раз в минуту, пока не получится."
                  : "UI связан с реальным AI workflow backend и realtime-каналом."}
            </span>
          </div>
          <span className="text-muted-foreground">
            {backendStatus.status === "online"
              ? "Backend online"
              : backendStatus.status === "warming"
                ? "Backend warming up"
                : "Backend offline"}
          </span>
          {Object.keys(pendingTasks).length > 0 && (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-500">
              {Object.keys(pendingTasks).length} task
              {Object.keys(pendingTasks).length === 1 ? "" : "s"} waiting for backend
            </span>
          )}
        </div>

        {/* Backend Status Toast - only show when offline */}
        {(backendStatus.status === "offline" || backendStatus.status === "warming") &&
          !workflow.isLoading && (
            <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right">
              <div className="max-w-sm rounded-2xl border border-amber-500/20 bg-card/95 p-4 shadow-2xl shadow-amber-950/10 backdrop-blur">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 grid size-9 place-items-center rounded-full bg-amber-500/10 text-amber-500">
                    <RefreshCw className="h-4.5 w-4.5 animate-spin" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">
                      {backendStatus.status === "warming"
                        ? "Сервер просыпается"
                        : "Backend недоступен"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {backendStatus.status === "warming"
                        ? "Это нормально для бесплатного рендера: сервер может запускаться около минуты. Экран будет сам повторять проверку, пока backend не ответит."
                        : "Работаем в демо-режиме. Можно повторить проверку вручную или просто дождаться автоподключения."}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void backendStatus.retry()}
                        className="inline-flex h-9 items-center gap-2 rounded-xl bg-amber-500 px-3 text-xs font-medium text-white transition hover:brightness-110"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Проверить снова
                      </button>
                      <span className="text-[10px] text-muted-foreground">
                        {backendStatus.lastCheck
                          ? `Последняя проверка: ${backendStatus.lastCheck.toLocaleTimeString(
                              "ru-RU",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              },
                            )}`
                          : "Идёт первичная проверка"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* OpenClaw Status Indicator */}
        {openclawConnected && (
          <div className="mb-3 flex items-center justify-end gap-2">
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              OpenClaw ● Online
            </span>
          </div>
        )}
        {!openclawConnected && !workflow.isLoading && (
          <div className="mb-3 flex items-center justify-end gap-2">
            <span className="rounded-full border border-muted-foreground/20 bg-muted px-2 py-0.5 text-[10px] text-muted-foreground flex items-center gap-1">
              Local Models Only
            </span>
          </div>
        )}

        {/* NVIDIA not configured warning - only show when backend is online */}
        {backendStatus.status === "online" && !nvidiaConfigured && !workflow.isLoading && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.055] px-3 py-2 text-[10px] text-amber-600 dark:text-amber-100">
            <AlertTriangle className="size-3.5" />
            {nvidiaMissing.length > 0
              ? "NVIDIA API key не настроен: Отсутствует: " + nvidiaMissing.join(", ")
              : "NVIDIA не подключена: маршрутизация работает, выполнение создаёт demo-результаты."}
          </div>
        )}

        {/* Supabase not configured warning */}
        {backendStatus.status === "online" && !supabaseConfigured && !workflow.isLoading && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/[0.035] px-3 py-2 text-[10px] text-destructive">
            <AlertTriangle className="size-3.5" />
            {supabaseMissing.length > 0
              ? "Supabase не настроен: Отсутствует: " + supabaseMissing.join(", ")
              : "Supabase backend is not configured"}
          </div>
        )}

        {/* OpenClaw not available warning */}
        {!openclawConnected && !workflow.isLoading && backendStatus.status !== "warming" && (
          <div className="mb-3 flex items-center justify-end gap-2">
            <span className="rounded-full border border-muted-foreground/20 bg-muted px-2 py-0.5 text-[10px] text-muted-foreground flex items-center gap-1">
              <svg
                className="size-3.5"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              {openclawDetail.configured
                ? "OpenClaw Gateway не отвечает"
                : "OpenClaw Gateway не настроен"}
            </span>
          </div>
        )}

        {showInitialLoading || workflow.isRecovering ? (
          <div className="grid min-h-[65vh] place-items-center rounded-2xl border border-border bg-surface/75">
            <div className="w-full max-w-5xl space-y-4 px-4 py-8">
              <div className="flex items-center justify-center gap-3 text-center">
                {workflow.isRecovering ? (
                  <RefreshCw className="size-8 animate-spin text-amber-500" />
                ) : (
                  <Loader2 className="size-8 animate-spin text-primary" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {workflow.isRecovering ? "Backend просыпается" : "Загружаю AI Workflow"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {workflow.isRecovering
                      ? "Система восстановит данные и состояние, как только backend ответит."
                      : "Подождите несколько секунд, пока подгружается актуальное состояние команд и задач."}
                  </p>
                </div>
              </div>
              {!workflow.isRecovering && (
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
                  <div className="space-y-3">
                    <div className="h-28 rounded-2xl border border-border/60 bg-card/50 animate-pulse" />
                    <div className="h-80 rounded-2xl border border-border/60 bg-card/50 animate-pulse" />
                    <div className="h-[32rem] rounded-2xl border border-border/60 bg-card/50 animate-pulse" />
                  </div>
                  <div className="space-y-3">
                    <div className="h-48 rounded-2xl border border-border/60 bg-card/50 animate-pulse" />
                    <div className="h-40 rounded-2xl border border-border/60 bg-card/50 animate-pulse" />
                    <div className="h-52 rounded-2xl border border-border/60 bg-card/50 animate-pulse" />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : workflow.error ? (
          <div className="grid min-h-[55vh] place-items-center rounded-2xl border border-destructive/25 bg-destructive/[0.035] px-5 text-center">
            <div className="max-w-md">
              <AlertTriangle className="mx-auto size-9 text-destructive" />
              <h2 className="mt-3 text-base font-semibold">AI Workflow пока недоступен</h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{workflow.error}</p>
              <button
                type="button"
                onClick={() => void workflow.refresh()}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-xs hover:border-primary/50"
              >
                <RefreshCw className="size-4" /> Повторить
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
            <div className="min-w-0 space-y-3">
              <WorkflowPlanCard
                tasks={overview.tasks}
                agents={overview.agents}
                runs={overview.workflow_runs}
                dependencies={overview.task_dependencies}
                onOpen={setSelectedTask}
                onControl={(task, action) => void handleControl(task, action)}
                isMutating={isMutating}
              />
              <TeamMap
                departments={overview.departments}
                agents={overview.agents}
                tasks={mapTasks}
                projects={overview.projects}
                approvals={overview.approval_requests}
                selectedDepartmentId={departmentId}
                selectedProjectId={projectId}
                lastRealtimeAt={workflow.lastRealtimeAt}
                onDepartmentClick={selectDepartment}
                onAgentClick={setSelectedAgent}
                onApprove={(task) => void handleApprove(task)}
                onReject={setRejectTask}
              />
              <TasksTable
                tasks={overview.tasks}
                projects={overview.projects}
                departments={overview.departments}
                agents={overview.agents}
                tab={taskTab}
                search={search}
                selectedDepartmentId={departmentId}
                onTabChange={setTaskTab}
                onClearDepartment={() => setDepartmentId("")}
                onOpen={setSelectedTask}
                onStatusChange={(task, status: WorkflowTaskStatus) =>
                  void handlePatch(task, { status }, "Статус обновлён")
                }
                onAssign={(task, agentId) => void handleAssign(task, agentId)}
                onRun={(task) => void handleRun(task)}
                onApproval={(task) =>
                  void handlePatch(
                    task,
                    { status: "approval_required", requires_approval: true },
                    "Задача отправлена CEO",
                  )
                }
                onControl={(task, action) => void handleControl(task, action)}
                pendingTasks={pendingTasks}
              />
            </div>
            <div className="min-w-0 xl:sticky xl:top-28 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
              <div className="space-y-3">
                <RightRail
                  events={overview.events}
                  artifacts={overview.artifacts}
                  tasks={overview.tasks}
                  agents={overview.agents}
                  projects={overview.projects}
                  approvals={overview.approval_requests}
                  selectedProjectId={projectId}
                  realtimeConnected={workflow.isRealtimeConnected || preview}
                  onTaskOpen={setSelectedTask}
                />

                {/* CEO Dashboard */}
                <div className="rounded-xl border border-border/50 bg-card/50 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Crown className="size-4 text-primary" />
                      <h3 className="text-xs font-medium">CEO Dashboard</h3>
                    </div>
                    <WorkflowChatPanel
                      open={chatOpen}
                      onOpenChange={setChatOpen}
                      onCreateTask={async (title, description) => {
                        await handleCreate({
                          organization_id: organizationId ?? "",
                          project_id: initialProjectId,
                          title,
                          description,
                          priority: "medium",
                          due_at: null,
                          attachments: [],
                          links: [],
                          department_id: null,
                          agent_id: null,
                          auto_assign: true,
                          source: "manual",
                          original_request: description,
                        });
                      }}
                    />
                  </div>
                  <CeoDashboard onRefresh={() => void workflow.refresh(true)} />
                </div>

                {/* Approval Gateway */}
                <div className="rounded-xl border border-border/50 bg-card/50 p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="size-4 text-amber-500" />
                    <h3 className="text-xs font-medium">Approval Gateway</h3>
                  </div>
                  <ApprovalGateway onRefresh={() => void workflow.refresh(true)} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <CreateTaskDialog
        open={createOpen}
        projects={overview.projects}
        departments={overview.departments}
        agents={overview.agents}
        initialProjectId={initialProjectId}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />
      <VoiceTaskDialog
        open={voiceOpen}
        projects={overview.projects}
        initialProjectId={initialProjectId}
        onOpenChange={setVoiceOpen}
        onTranscribe={async (audio) => {
          if (demoMode) throw new Error("В demo-режиме используйте ручной ввод задачи.");
          if (!accessToken || !organizationId) throw new Error("Сессия ещё загружается");
          const result = await transcribeWorkflowVoice(accessToken, organizationId, audio);
          return result.transcript;
        }}
        onCreate={async (voiceProjectId, transcript) =>
          handleCreate({
            project_id: voiceProjectId,
            title: transcript.slice(0, 110),
            description: transcript,
            priority: "medium",
            due_at: null,
            attachments: [],
            links: [],
            department_id: null,
            agent_id: null,
            auto_assign: true,
            source: "voice",
            original_request: transcript,
          })
        }
        onManualFallback={() => {
          setVoiceOpen(false);
          setCreateOpen(true);
        }}
      />
      <RejectTaskDialog
        task={rejectTask}
        onClose={() => setRejectTask(null)}
        onReject={handleReject}
      />
      <AgentProfileDialog
        agent={selectedAgent}
        tasks={overview.tasks}
        events={overview.events}
        artifacts={overview.artifacts}
        projects={overview.projects}
        onClose={() => setSelectedAgent(null)}
        onAssign={async (task, agent) => handleAssign(task, agent.id)}
      />
      <TaskDetailDialog
        task={selectedTask}
        project={selectedTask?.project_id ? projectById.get(selectedTask.project_id) : undefined}
        agent={selectedTask?.agent_id ? agentById.get(selectedTask.agent_id) : undefined}
        departmentName={
          selectedTask?.department_id
            ? departmentById.get(selectedTask.department_id)?.name
            : undefined
        }
        artifacts={overview.artifacts}
        onClose={() => setSelectedTask(null)}
        onRun={(task) => void handleRun(task)}
        onApproval={(task) =>
          void handlePatch(
            task,
            { status: "approval_required", requires_approval: true },
            "Задача отправлена CEO",
          )
        }
      />

      {(mutationMessage || mutationError || isMutating) && (
        <div
          className={`fixed bottom-5 right-5 z-[70] flex max-w-sm items-center gap-2 rounded-xl border px-4 py-3 text-xs shadow-2xl backdrop-blur-xl ${mutationError ? "border-destructive/35 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/10 text-primary"}`}
        >
          {isMutating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : mutationError ? (
            <AlertTriangle className="size-4" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          <span>{mutationError || mutationMessage || "Обновляю AI Workflow…"}</span>
          {mutationError && (
            <button
              type="button"
              onClick={() => setMutationError(null)}
              className="ml-2 text-muted-foreground"
            >
              ×
            </button>
          )}
        </div>
      )}
    </AppShell>
  );
}
