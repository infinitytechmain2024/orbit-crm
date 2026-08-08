export type TaskStatus =
  "backlog" | "planned" | "in_progress" | "review" | "blocked" | "completed" | "cancelled";
export type Priority = "low" | "med" | "high";
export type TaskView = "kanban" | "list";
export type TaskSortDirection = "asc" | "desc";
export type TaskSortKey =
  "position" | "title" | "project" | "status" | "priority" | "dueDate" | "assignee" | "updatedAt";
export type TaskListColumn =
  "title" | "project" | "status" | "priority" | "dueDate" | "assignee" | "checklist" | "blocked";
export type ProjectStatus = "planned" | "active" | "paused" | "completed" | "archived";
export type ProjectPriority = "low" | "medium" | "high" | "critical";

export type TaskLabel = {
  id: string;
  organizationId: string;
  name: string;
  color: string;
};

export type TaskChecklistItem = {
  id: string;
  taskId: string;
  title: string;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
};

export type TaskComment = {
  id: string;
  taskId: string;
  body: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskFile = {
  id: string;
  taskId: string;
  bucketId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
};

export type Task = {
  id: string;
  organizationId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  note: string | null;
  status: TaskStatus;
  priority: Priority;
  projectId: string | null;
  startDate: string | null;
  dueDate: string | null;
  due: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  assigneeId: string | null;
  assigneeIds: string[];
  watcherIds: string[];
  authorId: string;
  expectedRevenue: number | null;
  internalCost: number | null;
  currency: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  tags: string[];
  labels: TaskLabel[];
  checklistItems: TaskChecklistItem[];
  comments: TaskComment[];
  files: TaskFile[];
  financeOperationsCount: number;
};

export type TaskInput = {
  title: string;
  description?: string | null;
  note?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  projectId?: string | null;
  parentTaskId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  actualMinutes?: number;
  assigneeId?: string | null;
  assigneeIds?: string[];
  watcherIds?: string[];
  expectedRevenue?: number | null;
  internalCost?: number | null;
  currency?: string;
  sortOrder?: number;
  labelIds?: string[];
  newLabelNames?: string[];
  checklistTitles?: string[];
  subtaskTitles?: string[];
  tags?: string[];
};

export type TaskPatch = Partial<
  Pick<
    TaskInput,
    | "title"
    | "description"
    | "note"
    | "status"
    | "priority"
    | "projectId"
    | "parentTaskId"
    | "startDate"
    | "dueDate"
    | "estimatedMinutes"
    | "actualMinutes"
    | "assigneeId"
    | "assigneeIds"
    | "watcherIds"
    | "expectedRevenue"
    | "internalCost"
    | "currency"
    | "sortOrder"
    | "labelIds"
    | "newLabelNames"
    | "tags"
  >
>;

export type TaskFilters = {
  search: string;
  projectId: string;
  status: TaskStatus | "all";
  priority: Priority | "all";
  assigneeId: string;
  tag: string;
  overdue: "all" | "overdue";
  dateFrom: string;
  dateTo: string;
};

export type TaskSort = {
  key: TaskSortKey;
  direction: TaskSortDirection;
};

export type TaskPreferences = {
  view: TaskView;
  filters: TaskFilters;
  listColumns: TaskListColumn[];
  sort: TaskSort;
  pageSize: number;
};

export type Project = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  color: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: string | null;
  dueDate: string | null;
  ownerId: string | null;
  budgetPlanned: number | null;
  currency: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  x: number;
  y: number;
  links: string[];
  memberIds: string[];
};

export type ProjectInput = {
  name: string;
  description?: string | null;
  color?: string;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  startDate?: string | null;
  dueDate?: string | null;
  ownerId?: string | null;
  budgetPlanned?: number | null;
  currency?: string;
  memberIds?: string[];
};

export type ProjectPatch = ProjectInput;

export type OrganizationMember = {
  userId: string;
  role: "owner" | "admin" | "manager" | "member" | "accountant";
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

export type Email = {
  id: string;
  from: string;
  subject: string;
  preview: string;
  body: string;
  date: string;
  unread: boolean;
};

export type Tx = {
  id: string;
  label: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  date: string;
  dateIso: string;
  taskId: string | null;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Бэклог",
  planned: "Запланировано",
  in_progress: "В работе",
  review: "На проверке",
  blocked: "Заблокировано",
  completed: "Завершено",
  cancelled: "Отменено",
};

export const TASK_STATUSES: TaskStatus[] = [
  "backlog",
  "planned",
  "in_progress",
  "review",
  "blocked",
  "completed",
  "cancelled",
];

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Низкий",
  med: "Средний",
  high: "Высокий",
};

export const TASK_PRIORITIES: Priority[] = ["low", "med", "high"];

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  search: "",
  projectId: "all",
  status: "all",
  priority: "all",
  assigneeId: "all",
  tag: "",
  overdue: "all",
  dateFrom: "",
  dateTo: "",
};

export const DEFAULT_TASK_LIST_COLUMNS: TaskListColumn[] = [
  "title",
  "project",
  "status",
  "priority",
  "dueDate",
  "assignee",
  "checklist",
  "blocked",
];

export const TASK_LIST_COLUMN_LABEL: Record<TaskListColumn, string> = {
  title: "Задача",
  project: "Проект",
  status: "Статус",
  priority: "Приоритет",
  dueDate: "Срок",
  assignee: "Исполнитель",
  checklist: "Чек-лист",
  blocked: "Блок",
};

export const DEFAULT_TASK_PREFERENCES: TaskPreferences = {
  view: "kanban",
  filters: DEFAULT_TASK_FILTERS,
  listColumns: DEFAULT_TASK_LIST_COLUMNS,
  sort: {
    key: "updatedAt",
    direction: "desc",
  },
  pageSize: 25,
};

export const PROJECT_STATUS_OPTIONS: ProjectStatus[] = [
  "planned",
  "active",
  "paused",
  "completed",
  "archived",
];

export const PROJECT_PRIORITY_OPTIONS: ProjectPriority[] = ["low", "medium", "high", "critical"];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: "Планируется",
  active: "Активный",
  paused: "На паузе",
  completed: "Завершён",
  archived: "Архив",
};

export const PROJECT_PRIORITY_LABEL: Record<ProjectPriority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  critical: "Критичный",
};

export const PROJECT_COLORS = [
  "var(--acc-1)",
  "var(--acc-2)",
  "var(--acc-3)",
  "var(--acc-4)",
  "#8b5cf6",
  "#ec4899",
] as const;

export const initialEmails: Email[] = [
  {
    id: "e1",
    from: "anna@nordwind.co",
    subject: "Правки по договору и сроки",
    preview: "Привет! Посмотрели смету, есть два пункта…",
    body: "Привет!\n\nПосмотрели смету, есть два пункта по срокам: перенос этапа интеграции на 20 августа и фиксация стоимости поддержки.\n\nСможешь прислать обновлённый вариант до пятницы?\n\nАнна",
    date: "09:12",
    unread: true,
  },
  {
    id: "e2",
    from: "billing@stripe.com",
    subject: "Выплата 2 480 € отправлена",
    preview: "Ваша выплата в размере 2 480 € отправлена…",
    body: "Выплата 2 480 € отправлена на счёт ****4021. Ожидаемое зачисление — 2 рабочих дня.",
    date: "Вчера",
    unread: true,
  },
  {
    id: "e3",
    from: "team@figma.com",
    subject: "Комментарии в файле CRM / Dashboard",
    preview: "3 новых комментария ждут ответа…",
    body: "3 новых комментария в файле «CRM / Dashboard»: сетка виджетов, контраст тёмной темы, состояние загрузки.",
    date: "Пн",
    unread: false,
  },
  {
    id: "e4",
    from: "hello@indiehackers.dev",
    subject: "Приглашение выступить с докладом",
    preview: "Хотим позвать вас на онлайн-митап…",
    body: "Хотим позвать вас на онлайн-митап 5 сентября с докладом про личные системы продуктивности. 30 минут + Q&A.",
    date: "Пн",
    unread: false,
  },
];
