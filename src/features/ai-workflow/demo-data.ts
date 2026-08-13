import type { WorkflowOverview, WorkflowTaskStatus } from "./types";

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const now = "2026-08-13T08:30:00.000Z";

const projects = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Orbit CRM",
    color: "#20d4c6",
    status: "active",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "OSNOVA",
    color: "#8b7cf6",
    status: "active",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "BERRDO",
    color: "#f0b73f",
    status: "active",
  },
];

const departments = [
  {
    id: "20000000-0000-4000-8000-000000000004",
    organization_id: ORG,
    name: "CEO",
    color: "#f59e0b",
    icon: "user-round",
    created_at: now,
  },
  {
    id: "20000000-0000-4000-8000-000000000001",
    organization_id: ORG,
    name: "Chief of Development Department",
    color: "#25c8f4",
    icon: "code-2",
    created_at: now,
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    organization_id: ORG,
    name: "Chief Marketing Operation",
    color: "#20d4c6",
    icon: "megaphone",
    created_at: now,
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    organization_id: ORG,
    name: "HR",
    color: "#8b7cf6",
    icon: "users-round",
    created_at: now,
  },
];

const agentSeed = [
  [0, "CEO", "Chief Executive Officer", ["reasoning", "long_context"]],
  [1, "Frontend", "Интерфейсы и адаптивность", ["coding", "reasoning", "vision"]],
  [1, "Backend", "API, база данных и авторизация", ["coding", "reasoning"]],
  [1, "QA / DevOps", "Тесты, CI/CD и мониторинг", ["coding", "analysis", "fast"]],
  [1, "AI Integrations", "Модели, промпты и пайплайны", ["coding", "reasoning"]],
  [2, "CMO", "Стратегия и планы роста", ["writing", "analysis", "reasoning"]],
  [2, "Sales Rep", "Лиды и коммерческие предложения", ["writing", "fast"]],
  [2, "SEO", "Семантика и контент-планы", ["writing", "analysis", "reasoning"]],
  [2, "SMM", "Социальные сети и публикации", ["writing", "fast"]],
  [2, "Рассылка", "Email-цепочки и сегментация", ["writing", "analysis"]],
  [2, "Парсинг", "Сбор структурированных данных", ["analysis", "fast", "long_context"]],
  [2, "Data Analyst", "Аналитика, отчёты и KPI", ["analysis", "reasoning"]],
  [3, "Рекрутинг", "Вакансии и отбор кандидатов", ["writing", "analysis"]],
  [3, "Онбординг", "Адаптация новых сотрудников", ["writing", "reasoning"]],
  [3, "People Ops", "Командные процессы", ["analysis", "reasoning"]],
  [3, "COO", "Операционная координация", ["analysis", "reasoning"]],
] as const;

const agents = agentSeed.map(([departmentIndex, role, description, capabilities], index) => ({
  id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  organization_id: ORG,
  department_id: departmentIndex === null ? null : (departments[departmentIndex]?.id ?? null),
  name: role,
  role,
  description,
  status: ([1, 2, 4, 7, 12].includes(index) ? "working" : "idle") as "working" | "idle",
  capabilities: [...capabilities],
  default_model: index === 0 ? "nvidia/reasoning-long-context" : "nvidia/capability-router",
  fallback_models: ["nvidia/fallback-fast"],
  is_active: true,
  created_at: now,
}));

const taskSeed: Array<
  [string, number, number, WorkflowTaskStatus, "low" | "medium" | "high" | "critical", string]
> = [
  ["Оптимизация запросов API", 0, 2, "in_progress", "high", "2026-08-13T15:00:00.000Z"],
  ["Адаптивная таблица AI Workflow", 0, 1, "in_progress", "high", "2026-08-13T16:00:00.000Z"],
  ["Регрессионные тесты релиза", 0, 3, "queued", "medium", "2026-08-13T18:00:00.000Z"],
  ["Обновить NVIDIA fallback", 0, 4, "done", "medium", "2026-08-13T12:00:00.000Z"],
  ["Контент-план BERRDO", 2, 7, "approval_required", "critical", "2026-08-13T17:00:00.000Z"],
  ["Семантика посадочных страниц", 2, 7, "in_progress", "high", "2026-08-13T19:00:00.000Z"],
  ["Скрипты холодных звонков", 1, 6, "queued", "medium", "2026-08-13T20:59:00.000Z"],
  ["План публикаций на неделю", 2, 8, "queued", "medium", "2026-08-14T09:00:00.000Z"],
  ["Сегментация email-базы", 0, 9, "done", "low", "2026-08-13T10:00:00.000Z"],
  ["Сбор контактов из источников", 1, 10, "in_progress", "medium", "2026-08-13T20:00:00.000Z"],
  ["Аналитика Q2 и KPI", 0, 11, "done", "high", "2026-08-13T11:00:00.000Z"],
  ["Отбор кандидатов Frontend", 2, 12, "in_progress", "high", "2026-08-13T18:30:00.000Z"],
  ["План онбординга Backend", 2, 13, "queued", "medium", "2026-08-14T12:00:00.000Z"],
  ["Пульс команды", 0, 14, "done", "low", "2026-08-13T09:00:00.000Z"],
  ["Операционный регламент", 1, 15, "queued", "high", "2026-08-15T12:00:00.000Z"],
];

const tasks = taskSeed.map(([title, projectIndex, agentIndex, status, priority, dueAt], index) => ({
  id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  organization_id: ORG,
  project_id: projects[projectIndex]?.id ?? null,
  department_id: agents[agentIndex]?.department_id ?? null,
  agent_id: agents[agentIndex]?.id ?? null,
  parent_task_id: null,
  title,
  description: `Рабочая задача AI-команды: ${title}. Результат должен быть проверяемым и готовым к использованию в проекте.`,
  status,
  priority,
  due_at: dueAt,
  input_data: { preview: true },
  result:
    status === "done"
      ? {
          mode: "demo",
          summary: `${title} — результат подготовлен`,
          content: "Готовый результат сохранён в артефактах проекта.",
        }
      : null,
  current_model: "nvidia/capability-router",
  created_by: USER,
  created_at: `2026-08-13T0${index % 9}:00:00.000Z`,
  updated_at: `2026-08-13T${String(8 + (index % 8)).padStart(2, "0")}:20:00.000Z`,
}));

const events = tasks.slice(0, 9).map((task, index) => ({
  id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  organization_id: ORG,
  task_id: task.id,
  project_id: task.project_id,
  agent_id: task.agent_id,
  event_type: ["completed", "started", "approval_requested", "assigned"][index % 4] ?? "updated",
  message:
    [
      "завершил рабочий результат",
      "начал выполнение задачи",
      "отправил результат на утверждение CEO",
      "получил новую задачу от AI Router",
    ][index % 4] ?? "обновил задачу",
  metadata: { preview: true },
  created_at: `2026-08-13T${String(15 - index).padStart(2, "0")}:${String(index * 5).padStart(2, "0")}:00.000Z`,
}));

const artifacts = tasks
  .filter((task) => task.status === "done")
  .map((task, index) => ({
    id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    organization_id: ORG,
    task_id: task.id,
    project_id: task.project_id,
    agent_id: task.agent_id,
    name:
      ["AI API integration.md", "Сегментация базы.xlsx", "Аналитика Q2.pdf", "Team pulse.csv"][
        index
      ] ?? `Результат ${index + 1}`,
    type: ["code", "spreadsheet", "pdf", "table"][index] ?? "document",
    url: `?preview=1&task=${task.id}`,
    metadata: { preview: true },
    created_at: task.updated_at,
  }));

const approvalTask = tasks.find((task) => task.status === "approval_required")!;

export function createDemoOverview(projectId = "all"): WorkflowOverview {
  const selectedTasks =
    projectId === "all" ? tasks : tasks.filter((task) => task.project_id === projectId);
  const selectedIds = new Set(selectedTasks.map((task) => task.id));
  const timedEvents = events.map((event, index) => ({
    ...event,
    created_at: new Date(Date.now() - (index + 1) * 15 * 60_000).toISOString(),
  }));
  const timedArtifacts = artifacts.map((artifact, index) => ({
    ...artifact,
    created_at: new Date(Date.now() - (index + 2) * 28 * 60_000).toISOString(),
  }));
  return {
    departments,
    agents,
    tasks: selectedTasks,
    events: timedEvents.filter((event) => selectedIds.has(event.task_id)),
    artifacts: timedArtifacts.filter((artifact) => selectedIds.has(artifact.task_id)),
    approval_requests: selectedIds.has(approvalTask.id)
      ? [
          {
            id: "70000000-0000-4000-8000-000000000001",
            organization_id: ORG,
            task_id: approvalTask.id,
            requested_by_agent_id: approvalTask.agent_id,
            assigned_to_agent_id: agents[0]?.id ?? null,
            status: "pending",
            action: "Публикация изменений",
            reason: "Перед внешним действием требуется решение пользователя.",
            risk: "high",
            executor: "Orbit Commander",
            estimated_cost: null,
            currency: "EUR",
            consequences: "Изменения станут доступны внешним пользователям.",
            decision_comment: null,
            created_at: "2026-08-13T14:15:00.000Z",
            resolved_at: null,
          },
        ]
      : [],
    projects,
    model_configs: [
      {
        id: "80000000-0000-4000-8000-000000000001",
        provider: "nvidia",
        model_name: "nvidia/capability-router",
        capabilities: ["coding", "reasoning", "fast", "long_context", "writing", "analysis"],
        priority: 100,
        is_enabled: true,
        max_retries: 1,
      },
    ],
    workflow_runs: [],
    task_dependencies: [],
    agent_runs: [],
    notifications: [],
    provider: {
      nvidia_configured: true,
      configured: ["nvidia"],
      voice_configured: true,
      autorun: true,
      worker_enabled: true,
    },
  };
}

export const DEMO_ORGANIZATION_ID = ORG;
export const DEMO_USER_ID = USER;
