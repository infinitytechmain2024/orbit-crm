import type { CrmSnapshot } from "@/lib/crm-repository";
import type { Project, Task } from "@/lib/crm-data";

const ORG_ID = "10000000-0000-4000-8000-000000000001";
const USER_ONE = "20000000-0000-4000-8000-000000000001";
const USER_TWO = "20000000-0000-4000-8000-000000000002";
const USER_THREE = "20000000-0000-4000-8000-000000000003";
const PROJECT_TRAVEL = "30000000-0000-4000-8000-000000000001";
const PROJECT_BERRDO = "30000000-0000-4000-8000-000000000002";
const PROJECT_OSNOVA = "30000000-0000-4000-8000-000000000003";

function project(input: Partial<Project> & Pick<Project, "id" | "name">): Project {
  return {
    id: input.id,
    organizationId: ORG_ID,
    name: input.name,
    description: input.description ?? null,
    color: input.color ?? "#19d5c1",
    status: input.status ?? "active",
    priority: input.priority ?? "high",
    startDate: "2026-07-01",
    dueDate: "2026-10-30",
    ownerId: USER_ONE,
    budgetPlanned: 28000,
    currency: "EUR",
    createdBy: USER_ONE,
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-08-12T15:00:00.000Z",
    archivedAt: null,
    x: input.x ?? 50,
    y: input.y ?? 50,
    links: input.links ?? [],
    memberIds: input.memberIds ?? [USER_ONE, USER_TWO],
  };
}

function task(
  index: number,
  title: string,
  projectId: string,
  overrides: Partial<Task> = {},
): Task {
  const id = `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    id,
    organizationId: ORG_ID,
    parentTaskId: null,
    title,
    description: overrides.description ?? null,
    note: overrides.note ?? null,
    status: overrides.status ?? "in_progress",
    priority: overrides.priority ?? "med",
    projectId,
    startDate: "2026-08-01",
    dueDate: "2026-08-28",
    due: "28 авг",
    estimatedMinutes: 240,
    actualMinutes: 90,
    assigneeId: overrides.assigneeId ?? USER_TWO,
    assigneeIds: overrides.assigneeIds ?? [USER_TWO],
    watcherIds: [USER_ONE],
    authorId: USER_ONE,
    expectedRevenue: null,
    internalCost: null,
    currency: "EUR",
    sortOrder: index,
    createdAt: `2026-08-${String(Math.min(index, 12)).padStart(2, "0")}T09:00:00.000Z`,
    updatedAt: "2026-08-12T14:00:00.000Z",
    completedAt: overrides.status === "completed" ? "2026-08-11T16:00:00.000Z" : null,
    archivedAt: null,
    tags: overrides.tags ?? [],
    labels: overrides.labels ?? [],
    checklistItems: overrides.checklistItems ?? [],
    comments: overrides.comments ?? [],
    files: overrides.files ?? [],
    financeOperationsCount: overrides.financeOperationsCount ?? 0,
  };
}

const travelTasks: Task[] = [
  task(1, "Структура сайта Aybolit", PROJECT_TRAVEL, {
    description: "Карта страниц, клиник и медицинских направлений",
    status: "completed",
    assigneeIds: [USER_ONE, USER_TWO],
    labels: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        organizationId: ORG_ID,
        name: "Сайт",
        color: "#2ea8f0",
      },
    ],
    checklistItems: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        taskId: "40000000-0000-4000-8000-000000000001",
        title: "Кардиология",
        completedAt: "2026-08-10T10:00:00.000Z",
        sortOrder: 1,
        createdAt: "2026-08-02T09:00:00.000Z",
      },
      {
        id: "60000000-0000-4000-8000-000000000002",
        taskId: "40000000-0000-4000-8000-000000000001",
        title: "Онкология",
        completedAt: null,
        sortOrder: 2,
        createdAt: "2026-08-02T09:10:00.000Z",
      },
    ],
  }),
  task(2, "Контент-план клиник", PROJECT_TRAVEL, {
    description: "Статьи, исследования и SEO-тексты",
    status: "completed",
    labels: [
      {
        id: "50000000-0000-4000-8000-000000000002",
        organizationId: ORG_ID,
        name: "Контент",
        color: "#8d72d8",
      },
    ],
    comments: [
      {
        id: "70000000-0000-4000-8000-000000000001",
        taskId: "40000000-0000-4000-8000-000000000002",
        body: "Согласовать медицинскую терминологию с редактором",
        createdBy: USER_THREE,
        createdAt: "2026-08-12T09:00:00.000Z",
        updatedAt: "2026-08-12T09:00:00.000Z",
      },
    ],
  }),
  task(3, "Визуалы для Германии", PROJECT_TRAVEL, {
    description: "Фотографии палат, врачей и консультаций",
    assigneeId: USER_THREE,
    assigneeIds: [USER_THREE],
    files: [
      {
        id: "80000000-0000-4000-8000-000000000001",
        taskId: "40000000-0000-4000-8000-000000000003",
        bucketId: "task-files",
        storagePath: `${ORG_ID}/preview/germany-room.webp`,
        fileName: "Германия — палата.webp",
        mimeType: "image/webp",
        sizeBytes: 824000,
        uploadedBy: USER_THREE,
        createdAt: "2026-08-12T12:00:00.000Z",
      },
      {
        id: "80000000-0000-4000-8000-000000000002",
        taskId: "40000000-0000-4000-8000-000000000003",
        bucketId: "task-files",
        storagePath: `${ORG_ID}/preview/visual-guide.pdf`,
        fileName: "Гайд по визуалам.pdf",
        mimeType: "application/pdf",
        sizeBytes: 410000,
        uploadedBy: USER_THREE,
        createdAt: "2026-08-11T12:00:00.000Z",
      },
    ],
  }),
  task(4, "Кампании продвижения", PROJECT_TRAVEL, {
    description: "Стратегия, ссылки и рекламные кампании",
    assigneeIds: [USER_ONE, USER_TWO],
  }),
  task(5, "Консультация: генерация", PROJECT_TRAVEL, {
    description: "AI-материалы для первичной консультации",
    status: "completed",
  }),
  task(6, "Согласовать SEO-тексты", PROJECT_TRAVEL, {
    description: "Финальная проверка страниц направлений",
    status: "review",
  }),
];

export const GRAPH_PREVIEW_SNAPSHOT: CrmSnapshot = {
  organization: { id: ORG_ID, name: "Orbit Preview", slug: "orbit-preview" },
  members: [
    {
      userId: USER_ONE,
      role: "owner",
      email: "daria@orbit.example",
      fullName: "Дарья Орлова",
      avatarUrl: null,
    },
    {
      userId: USER_TWO,
      role: "manager",
      email: "alex@orbit.example",
      fullName: "Алексей Волков",
      avatarUrl: null,
    },
    {
      userId: USER_THREE,
      role: "member",
      email: "maria@orbit.example",
      fullName: "Мария Левина",
      avatarUrl: null,
    },
  ],
  projects: [
    project({
      id: PROJECT_TRAVEL,
      name: "Лечение за рубежом",
      description: "Сайт, контент, визуалы и продвижение медицинских услуг",
      links: [PROJECT_BERRDO, PROJECT_OSNOVA],
      memberIds: [USER_ONE, USER_TWO, USER_THREE],
    }),
    project({
      id: PROJECT_BERRDO,
      name: "BERRDO",
      description: "Бренд и контентная платформа",
      color: "#8f78d8",
      links: [PROJECT_TRAVEL],
    }),
    project({
      id: PROJECT_OSNOVA,
      name: "ОСНОВА Реабилитация",
      description: "Центр восстановления и реабилитации",
      color: "#8795c8",
      links: [PROJECT_TRAVEL],
    }),
  ],
  tasks: [
    ...travelTasks,
    task(7, "Бренд-платформа", PROJECT_BERRDO, { status: "completed" }),
    task(8, "Новая серия материалов", PROJECT_BERRDO),
    task(9, "Программа реабилитации", PROJECT_OSNOVA, { status: "completed" }),
    task(10, "Страница специалистов", PROJECT_OSNOVA),
  ],
  taskLabels: [],
  txs: [
    {
      id: "90000000-0000-4000-8000-000000000001",
      label: "Продвижение — август",
      amount: 4200,
      type: "expense",
      category: "Маркетинг",
      date: "12 авг",
      dateIso: "2026-08-12",
      taskId: "40000000-0000-4000-8000-000000000004",
    },
  ],
};
