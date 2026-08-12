import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/crm/AppShell";
import { useAuth } from "@/lib/auth";
import { useCrm } from "@/lib/crm-store";
import {
  assignWorkflowTask,
  createWorkflowTask,
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
import { DEMO_ORGANIZATION_ID, DEMO_USER_ID } from "@/features/ai-workflow/demo-data";

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
  const rules: Array<[RegExp, string]> = [
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
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? "COO";
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
  const preview =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "1";
  const accessToken = session?.access_token;
  const organizationId = preview ? DEMO_ORGANIZATION_ID : organization?.id;
  const workflow = useAiWorkflow(accessToken, organizationId, projectId, preview);
  const { overview } = workflow;

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
    if (preview) {
      const agent = overview.agents.find((item) => item.role === previewRoleForTask(input));
      const task: WorkflowTask = {
        id: crypto.randomUUID(),
        organization_id: organizationId,
        project_id: input.project_id,
        department_id: agent?.department_id ?? null,
        agent_id: agent?.id ?? null,
        parent_task_id: null,
        title: input.title,
        description: input.description,
        status: "queued",
        priority: input.priority,
        due_at: input.due_at,
        input_data: { preview: true, auto_assign: input.auto_assign },
        result: null,
        current_model: "nvidia/capability-router",
        created_by: DEMO_USER_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      workflow.prependTask(task, `AI Router назначил задачу агенту ${agent?.role ?? "COO"}.`);
      notify("Demo-задача создана и назначена AI Router");
      return;
    }
    if (!accessToken) throw new Error("Сессия ещё загружается");
    await perform(async () => {
      const response = await createWorkflowTask(accessToken, {
        organization_id: organizationId,
        ...input,
      });
      workflow.prependTask(
        response.task,
        "AI Router назначил исполнителя и поставил задачу в очередь.",
      );
      await workflow.refresh(true);
    }, "Задача создана и передана AI Router");
  }

  async function handlePatch(task: WorkflowTask, patch: Record<string, unknown>, success: string) {
    if (!organizationId) return;
    if (preview) {
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
    if (preview) {
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
    if (preview) {
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

  async function handleApprove(task: WorkflowTask) {
    if (!organizationId) return;
    if (preview) {
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

  async function handleReject(comment: string) {
    if (!organizationId || !rejectTask) return;
    const task = rejectTask;
    if (preview) {
      workflow.updateLocalTask(task.id, {
        status: "revisions_requested",
        updated_at: new Date().toISOString(),
        input_data: { ...task.input_data, decision_comment: comment },
      });
      setRejectTask(null);
      notify("Задача возвращена на правки");
      return;
    }
    if (!accessToken) return;
    await perform(async () => {
      await decideWorkflowApproval(accessToken, task.id, organizationId, "reject", comment);
      setRejectTask(null);
      setSelectedTask(null);
      await workflow.refresh(true);
    }, "Задача возвращена на правки");
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
        {!overview.provider.nvidia_configured && !workflow.isLoading && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.055] px-3 py-2 text-[10px] text-amber-100">
            <span className="flex items-center gap-2">
              <Sparkles className="size-3.5" /> NVIDIA не подключена в локальном backend:
              маршрутизация и workflow работают, выполнение создаёт demo-результаты.
            </span>
            <span className="rounded-full border border-amber-400/20 px-2 py-1">Demo mode</span>
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
              <TeamMap
                departments={overview.departments}
                agents={overview.agents}
                tasks={mapTasks}
                projects={overview.projects}
                approvals={overview.approval_requests}
                selectedDepartmentId={departmentId}
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
              />
            </div>
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
          if (preview) throw new Error("В preview-режиме используйте ручной ввод задачи.");
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
