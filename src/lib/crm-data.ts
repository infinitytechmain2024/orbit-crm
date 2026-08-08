export type TaskStatus = "inbox" | "todo" | "doing" | "done";
export type Priority = "low" | "med" | "high";
export type ProjectStatus = "planned" | "active" | "paused" | "completed" | "archived";
export type ProjectPriority = "low" | "medium" | "high" | "critical";

export type Task = {
  id: string;
  title: string;
  note?: string | null;
  status: TaskStatus;
  priority: Priority;
  projectId: string | null;
  due?: string;
  dueDate?: string;
  tags: string[];
};

export type TaskInput = Partial<Omit<Task, "id">> & { title: string };
export type TaskPatch = Partial<Omit<Task, "id">>;

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
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: "Входящие",
  todo: "К работе",
  doing: "В работе",
  done: "Готово",
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
