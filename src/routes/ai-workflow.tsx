import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Crown, Loader2, RefreshCw, Shield, Wifi, WifiOff } from "lucide-react";
import { useMemo, useState } from "react";

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

function AIWorkflowPage() {
  const { organization } = useCrm();
  const { session } = useAuth();
  const [projectId, setProjectId] = useState("all");
  const [search, setSearch] = useState("");
  const [taskTab, setTaskTab] = useState<TaskTab>("all");
  const [departmentId, setDepartmentId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<WorkflowAgent | null>(null);
  const [selectedTask, setSelectedTask] = useState<WorkflowTask | null>(null);
  const [rejectTask, setRejectTask] = useState<WorkflowTask | null>(null);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isMutating, setMutating] = useState(false);
  const [cancelConfirmTask, setCancelConfirmTask] = useState<WorkflowTask | null>(null);
  const preview =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "1";
  const accessToken = session?.access_token;
  const organizationId = preview ? DEMO_ORGANIZATION_ID : organization?.id;
  const workflow = useAiWorkflow(accessToken, organizationId, projectId, preview);
  const demoMode = preview || workflow.isDemoFallback;
  const { overview } = workflow;
  
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

  async function handleCreate(input: Omit<NewWorkflowTask, "organization_id">) {
    if (!organizationId) throw new Error("Сессия ещё загружается");
    const { role, action } = previewRoleForTask(input);
    
    // CEO Dispatcher: Classify task and assess risk
    const fullText = `${input.title} ${input.description}`;
    const dispatchResult = dispatchTask(fullText, {
      currentProject: input.project_id ?? undefined,
      userId: session?.user?.id ?? undefined,
      allowDestructive: false,
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
        const changePackage = generateChangePackage({
          title: input.title,
          description: input.description,
          actionType: action,
          projectGuess: dispatchResult.taskId ? "Orbit CRM" : null,
        }, riskLevel);
        
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
    await perform(async () => {
      const response = await createWorkflowTask(accessToken, {
        organization_id: organizationId,
        ...input,
      });
      
      // If approval required, create approval request
      if (requiresApproval) {
        const changePackage = generateChangePackage({
          title: input.title,
          description: input.description,
          actionType: action,
          projectGuess: dispatchResult.taskId ? "Orbit CRM" : null,
        }, riskLevel);
        
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
    }, requiresApproval ? "Задача создана и отправлена на CEO-аппрув" : "Задача создана и передана AI Router");
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
    await perform(async () => {
      await runWorkflowTask(accessToken, task.id, organizationId);
      await workflow.refresh(true);
    }, "Задача запущена");
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
    await perform(async () => {
      const response = await controlWorkflowTask(accessToken, task.id, organizationId, action);
      workflow.prependTask(response.task);
      await workflow.refresh(true);
    }, successByAction[action]);
  }

  async function handleApprove(task: WorkflowTask) {
    if (!organizationId) return;
    if (demoMode) {
      workflow.updateLocalTask(task.id, { status: "done", updated_at: new Date().toISOString() });
      notify("CEO утвердил результат");
      return;
    }
    if (!accessToken) return;
    await perform(async () => {
      await decideWorkflowApproval(accessToken, task.id, organizationId, "approve");
      setSelectedTask(null);
      await workflow.refresh(true);
    }, "CEO утвердил результат");
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
      setRejectTask(null);
      notify(
        decision === "request_changes" ? "Запрошены изменения" : "Критическое действие отклонено",
      );
      return;
    }
    if (!accessToken) return;
    await perform(
      async () => {
        const approval = overview.approval_requests.find((item) => item.task_id === task.id);
        if (!approval) throw new Error("Запрос на подтверждение не найден");
        await decideApprovalRequest(accessToken, approval.id, organizationId, decision, comment);
        setRejectTask(null);
        setSelectedTask(null);
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
        {/* Backend Status Toast - only show when offline */}
        {backendStatus.status === "offline" && !workflow.isLoading && (
          <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right">
            <div className="bg-card border border-border rounded-lg p-4 shadow-lg max-w-sm">
              <div className="flex items-center gap-3">
                <WifiOff className="h-5 w-5 text-amber-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Backend недоступен</p>
                  <p className="text-xs text-muted-foreground">
                    Работаем в демо-режиме
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void backendStatus.retry()}
                  className="rounded-full border border-border px-2 py-1 transition hover:bg-muted"
                  aria-label="Повторить подключение"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Demo Mode Indicator - compact badge */}
        {backendStatus.isDemoMode && (
          <div className="mb-3 flex items-center justify-end gap-2">
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] text-primary flex items-center gap-1">
              <Wifi className="h-3 w-3" />
              Demo mode
            </span>
          </div>
        )}

        {/* NVIDIA not configured warning - only show when backend is online */}
        {backendStatus.status === "online" &&
          !overview.provider.nvidia_configured &&
          !workflow.isLoading && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.055] px-3 py-2 text-[10px] text-amber-100">
              <AlertTriangle className="size-3.5" />
              NVIDIA не подключена: маршрутизация работает, выполнение создаёт demo-результаты.
            </div>
          )}

        {workflow.isLoading ? (
          <div className="grid min-h-[65vh] place-items-center rounded-2xl border border-border bg-[#0b1925]/75">
            <div className="text-center">
              <Loader2 className="mx-auto size-8 animate-spin text-primary" />
              <p className="mt-3 text-xs text-muted-foreground">Собираю AI-команду…</p>
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
              />
            </div>
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
                <div className="flex items-center gap-2 mb-3">
                  <Crown className="size-4 text-primary" />
                  <h3 className="text-xs font-medium">CEO Dashboard</h3>
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
          className={`fixed bottom-5 right-5 z-[70] flex max-w-sm items-center gap-2 rounded-xl border px-4 py-3 text-xs shadow-2xl backdrop-blur-xl ${mutationError ? "border-destructive/35 bg-[#261319] text-red-200" : "border-primary/30 bg-[#0b2028] text-primary"}`}
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
