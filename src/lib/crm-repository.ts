import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Json, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import {
  DEFAULT_TASK_LIST_COLUMNS,
  DEFAULT_TASK_PREFERENCES,
  PROJECT_COLORS,
  TASK_LIST_COLUMN_LABEL,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Organization,
  type OrganizationMember,
  type Priority,
  type Project,
  type ProjectInput,
  type ProjectPatch,
  type Task,
  type TaskChecklistItem,
  type TaskComment,
  type TaskFile,
  type TaskFilters,
  type TaskInput,
  type TaskLabel,
  type TaskListColumn,
  type TaskPatch,
  type TaskPreferences,
  type TaskSort,
  type TaskSortDirection,
  type TaskSortKey,
  type TaskStatus,
  type TaskView,
  type Tx,
  type StripeTransaction,
  type StripeSubscription,
  type StripeCustomer,
} from "./crm-data";

type OrganizationRow = Tables<"organizations">;
type OrganizationMemberRow = Tables<"organization_members">;
type ProfileRow = Tables<"profiles">;
type ProjectRow = Tables<"projects">;
type ProjectLinkRow = Tables<"project_links">;
type ProjectMemberRow = Tables<"project_members">;
type TaskRow = Tables<"tasks">;
type TaskAssigneeRow = Tables<"task_assignees">;
type TaskWatcherRow = Tables<"task_watchers">;
type TaskLabelRow = Tables<"task_labels">;
type TaskLabelLinkRow = Tables<"task_label_links">;
type TaskChecklistItemRow = Tables<"task_checklist_items">;
type TaskCommentRow = Tables<"task_comments">;
type TaskFileRow = Tables<"files">;
type TaskViewPreferenceRow = Tables<"task_view_preferences">;
type FinanceTransactionRow = Tables<"finance_transactions">;
type StripeCustomerRow = Tables<"stripe_customers">;
type StripeTransactionRow = Tables<"stripe_transactions">;
type StripeSubscriptionRow = Tables<"stripe_subscriptions">;

type MembershipWithOrganization = OrganizationMemberRow & {
  organizations: OrganizationRow | null;
};

type TaskRelationMaps = {
  assigneeIdsByTask: Map<string, string[]>;
  watcherIdsByTask: Map<string, string[]>;
  labelsByTask: Map<string, TaskLabel[]>;
  checklistByTask: Map<string, TaskChecklistItem[]>;
  commentsByTask: Map<string, TaskComment[]>;
  filesByTask: Map<string, TaskFile[]>;
  financeCountByTask: Map<string, number>;
};

export type CrmSnapshot = {
  organization: Organization;
  members: OrganizationMember[];
  projects: Project[];
  tasks: Task[];
  taskLabels: TaskLabel[];
  txs: Tx[];
  stripeTransactions: StripeTransaction[];
  stripeSubscriptions: StripeSubscription[];
  stripeCustomer: StripeCustomer | null;
};

export type FinanceTransactionInput = {
  label: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  occurredOn?: string;
  taskId?: string | null;
};

export type TaskPage = {
  tasks: Task[];
  total: number;
  page: number;
  pageSize: number;
};

export type TaskQuery = {
  filters: TaskFilters;
  page: number;
  pageSize: number;
  sort: TaskSort;
};

export class TaskArchiveRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskArchiveRequiredError";
  }
}

const TASK_FILE_BUCKET = "task-files";
const MAX_TASK_FILE_BYTES = 6 * 1024 * 1024;
const ALLOWED_TASK_FILE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const dateLabelFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
});

const TASK_SORT_KEYS: TaskSortKey[] = [
  "position",
  "title",
  "project",
  "status",
  "priority",
  "dueDate",
  "assignee",
  "updatedAt",
];

const TASK_SORT_DIRECTIONS: TaskSortDirection[] = ["asc", "desc"];
const TASK_VIEWS: TaskView[] = ["kanban", "list"];
const TASK_LIST_COLUMNS = Object.keys(TASK_LIST_COLUMN_LABEL) as TaskListColumn[];

function ensureData<T>(data: T | null, message: string): T {
  if (data === null) throw new Error(message);
  return data;
}

function toMessage(message: string, errorMessage: string): Error {
  return new Error(`${message}: ${errorMessage}`);
}

function isMissingStripeTableError(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === "PGRST205" &&
    typeof error.message === "string" &&
    error.message.includes("stripe_")
  );
}

function makeOrganizationSlug(id: string): string {
  return `orbit-${id.slice(0, 8).toLowerCase()}`;
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readDate(value: unknown): string {
  const raw = readString(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function readIdFilter(value: unknown): string {
  const raw = readString(value).trim();
  return raw || "all";
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus);
}

function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && TASK_PRIORITIES.includes(value as Priority);
}

function isTaskView(value: unknown): value is TaskView {
  return typeof value === "string" && TASK_VIEWS.includes(value as TaskView);
}

function isTaskSortKey(value: unknown): value is TaskSortKey {
  return typeof value === "string" && TASK_SORT_KEYS.includes(value as TaskSortKey);
}

function isTaskSortDirection(value: unknown): value is TaskSortDirection {
  return typeof value === "string" && TASK_SORT_DIRECTIONS.includes(value as TaskSortDirection);
}

function isTaskListColumn(value: unknown): value is TaskListColumn {
  return typeof value === "string" && TASK_LIST_COLUMNS.includes(value as TaskListColumn);
}

function normalizeTaskFilters(value: unknown): TaskFilters {
  const source = isRecord(value) ? value : {};
  const status = source["status"];
  const priority = source["priority"];
  const overdue = source["overdue"];

  return {
    search: readString(source["search"]).trim().slice(0, 120),
    projectId: readIdFilter(source["projectId"]),
    status: isTaskStatus(status) ? status : "all",
    priority: isPriority(priority) ? priority : "all",
    assigneeId: readIdFilter(source["assigneeId"]),
    tag: readString(source["tag"]).trim().slice(0, 48),
    overdue: overdue === "overdue" ? "overdue" : "all",
    dateFrom: readDate(source["dateFrom"]),
    dateTo: readDate(source["dateTo"]),
  };
}

function normalizeTaskSort(key: unknown, direction: unknown): TaskSort {
  return {
    key: isTaskSortKey(key) ? key : DEFAULT_TASK_PREFERENCES.sort.key,
    direction: isTaskSortDirection(direction) ? direction : DEFAULT_TASK_PREFERENCES.sort.direction,
  };
}

function normalizeListColumns(value: unknown): TaskListColumn[] {
  if (!Array.isArray(value)) return DEFAULT_TASK_LIST_COLUMNS;

  const columns = value.filter(isTaskListColumn);
  return columns.length ? [...new Set(columns)] : DEFAULT_TASK_LIST_COLUMNS;
}

function normalizePageSize(value: unknown): number {
  const pageSize = typeof value === "number" && Number.isFinite(value) ? value : 25;
  return Math.min(100, Math.max(10, Math.round(pageSize)));
}

function mapTaskPreferences(row: TaskViewPreferenceRow | null): TaskPreferences {
  if (!row) return DEFAULT_TASK_PREFERENCES;

  return {
    view: isTaskView(row.selected_view) ? row.selected_view : DEFAULT_TASK_PREFERENCES.view,
    filters: normalizeTaskFilters(row.filters),
    listColumns: normalizeListColumns(row.list_columns),
    sort: normalizeTaskSort(row.sort_key, row.sort_direction),
    pageSize: normalizePageSize(row.page_size),
  };
}

function taskFiltersToJson(filters: TaskFilters): Json {
  return {
    search: filters.search,
    projectId: filters.projectId,
    status: filters.status,
    priority: filters.priority,
    assigneeId: filters.assigneeId,
    tag: filters.tag,
    overdue: filters.overdue,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  };
}

function todayIsoDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function sanitizePostgrestSearch(value: string): string {
  return value
    .trim()
    .replace(/[%,()]/g, " ")
    .replace(/\s+/g, "%")
    .slice(0, 80);
}

function sortColumn(sortKey: TaskSortKey): keyof TaskRow {
  const columns: Record<TaskSortKey, keyof TaskRow> = {
    position: "sort_order",
    title: "title",
    project: "project_id",
    status: "status",
    priority: "priority",
    dueDate: "due_date",
    assignee: "assignee_id",
    updatedAt: "updated_at",
  };

  return columns[sortKey];
}

function hasOwn<Key extends string>(source: object, key: Key): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function normalizeIntegerMinutes(value: number | null, fieldName: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} должно быть неотрицательным целым числом минут.`);
  }
  return value;
}

function normalizeMoney(value: number | null, fieldName: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} должно быть неотрицательным числом.`);
  }
  return value;
}

function normalizeSortOrder(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Позиция сортировки должна быть неотрицательным числом.");
  }
  return value;
}

function normalizeLabelNames(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const name = value?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function sanitizeStorageName(fileName: string): string {
  const normalized = fileName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

  return normalized || "attachment";
}

function validateTaskFile(file: File): void {
  if (file.size <= 0) throw new Error("Файл пустой и не может быть загружен.");
  if (file.size > MAX_TASK_FILE_BYTES) {
    throw new Error("Файл слишком большой. Максимальный размер вложения — 6 МБ.");
  }
  if (!ALLOWED_TASK_FILE_TYPES.has(file.type)) {
    throw new Error("Этот тип файла нельзя загрузить в задачу.");
  }
}

function mapOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
  };
}

function mapOrganizationMember(
  row: OrganizationMemberRow,
  profile: ProfileRow | undefined,
): OrganizationMember {
  return {
    userId: row.user_id,
    role: row.role,
    email: profile?.email ?? null,
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
}

function mapProject(row: ProjectRow, links: string[], memberIds: string[]): Project {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    color: row.color,
    status: row.status,
    priority: row.priority,
    startDate: row.start_date,
    dueDate: row.due_date,
    ownerId: row.owner_id,
    budgetPlanned: row.budget_planned === null ? null : Number(row.budget_planned),
    currency: row.currency,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    x: Number(row.x_position),
    y: Number(row.y_position),
    links,
    memberIds,
  };
}

function mapTaskLabel(row: TaskLabelRow): TaskLabel {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    color: row.color,
  };
}

function mapChecklistItem(row: TaskChecklistItemRow): TaskChecklistItem {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    completedAt: row.completed_at,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
  };
}

function mapTaskComment(row: TaskCommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    body: row.body,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaskFile(row: TaskFileRow): TaskFile {
  return {
    id: row.id,
    taskId: row.task_id,
    bucketId: row.bucket_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function emptyTaskRelations(): TaskRelationMaps {
  return {
    assigneeIdsByTask: new Map(),
    watcherIdsByTask: new Map(),
    labelsByTask: new Map(),
    checklistByTask: new Map(),
    commentsByTask: new Map(),
    filesByTask: new Map(),
    financeCountByTask: new Map(),
  };
}

function pushGroupedValue<T>(target: Map<string, T[]>, key: string, value: T): void {
  const current = target.get(key) ?? [];
  target.set(key, [...current, value]);
}

function mapTask(row: TaskRow, relations: TaskRelationMaps = emptyTaskRelations()): Task {
  const labels = relations.labelsByTask.get(row.id) ?? [];
  const tags = [...new Set([...(row.tags ?? []), ...labels.map((label) => label.name)])];
  const estimatedMinutes = row.estimated_minutes === null ? null : Number(row.estimated_minutes);
  const actualMinutes = Number(row.actual_minutes);
  const progress = Math.min(
    100,
    Math.max(0, Number((row as unknown as Record<string, unknown>)["progress"] ?? 0)),
  );
  const estimatedTimeRemaining =
    estimatedMinutes !== null && estimatedMinutes > 0
      ? Math.max(0, Math.round(estimatedMinutes * (1 - progress / 100)))
      : null;

  return {
    id: row.id,
    organizationId: row.organization_id,
    parentTaskId: row.parent_task_id,
    title: row.title,
    description: row.description,
    note: row.note,
    status: row.status as TaskStatus,
    priority: row.priority,
    projectId: row.project_id,
    startDate: row.start_date,
    dueDate: row.due_date,
    due: row.due_date ? dateLabelFormatter.format(new Date(`${row.due_date}T00:00:00`)) : null,
    estimatedMinutes,
    actualMinutes,
    assigneeId: row.assignee_id,
    assigneeIds: relations.assigneeIdsByTask.get(row.id) ?? [],
    watcherIds: relations.watcherIdsByTask.get(row.id) ?? [],
    authorId: row.author_id,
    expectedRevenue: row.expected_revenue === null ? null : Number(row.expected_revenue),
    internalCost: row.internal_cost === null ? null : Number(row.internal_cost),
    currency: row.currency,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    tags,
    labels,
    checklistItems: relations.checklistByTask.get(row.id) ?? [],
    comments: relations.commentsByTask.get(row.id) ?? [],
    files: relations.filesByTask.get(row.id) ?? [],
    financeOperationsCount: relations.financeCountByTask.get(row.id) ?? 0,
    progress,
    estimatedTimeRemaining,
    source: ((row as unknown as Record<string, unknown>)["source"] as string) ?? "manual",
    workflowStatus:
      ((row as unknown as Record<string, unknown>)["workflow_status"] as Task["workflowStatus"]) ??
      "manual",
    targetRole:
      ((row as unknown as Record<string, unknown>)["target_role"] as string | null) ?? null,
    dispatchToWorkflow: Boolean(
      (row as unknown as Record<string, unknown>)["dispatch_to_workflow"],
    ),
    aiWorkflowTaskId:
      ((row as unknown as Record<string, unknown>)["ai_workflow_task_id"] as string | null) ?? null,
  };
}

function mapTx(row: FinanceTransactionRow): Tx {
  return {
    id: row.id,
    label: row.label,
    amount: Number(row.amount),
    type: row.type,
    category: row.category,
    date: dateLabelFormatter.format(new Date(`${row.occurred_on}T00:00:00`)),
    dateIso: row.occurred_on,
    taskId: row.task_id,
  };
}

function normalizeFinanceTransactionInput(input: FinanceTransactionInput): {
  amount: number;
  category: string;
  label: string;
  occurredOn: string;
  taskId: string | null;
  type: "income" | "expense";
} {
  const label = input.label.trim();
  if (!label) throw new Error("Название операции обязательно.");

  const category = input.category.trim();
  if (!category) throw new Error("Категория операции обязательна.");

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Сумма должна быть положительным числом.");
  }

  const occurredOn = /^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn ?? "")
    ? (input.occurredOn as string)
    : todayIsoDate();

  return {
    amount: Math.round(amount * 100) / 100,
    category,
    label,
    occurredOn,
    taskId: input.taskId ?? null,
    type: input.type,
  };
}

function mapStripeCustomer(row: StripeCustomerRow): StripeCustomer {
  return {
    id: row.id,
    organizationId: row.organization_id,
    stripeCustomerId: row.stripe_customer_id,
    email: row.email,
  };
}

function mapStripeTransaction(row: StripeTransactionRow): StripeTransaction {
  return {
    id: row.id,
    organizationId: row.organization_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeCustomerId: row.stripe_customer_id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status as StripeTransaction["status"],
    paymentMethodType: row.payment_method_type,
    description: row.description,
    metadata: row.metadata as Record<string, unknown>,
    date: dateLabelFormatter.format(new Date(`${row.occurred_on}T00:00:00`)),
    dateIso: row.occurred_on,
  };
}

function mapStripeSubscription(row: StripeSubscriptionRow): StripeSubscription {
  return {
    id: row.id,
    organizationId: row.organization_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    stripePriceId: row.stripe_price_id,
    status: row.status as StripeSubscription["status"],
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    amount: Number(row.amount),
    currency: row.currency,
    interval: row.interval as StripeSubscription["interval"],
    metadata: row.metadata as Record<string, unknown>,
  };
}

async function fetchMemberships(userId: string): Promise<MembershipWithOrganization[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select(
      "organization_id,user_id,role,created_at,updated_at,created_by,organizations(id,name,slug,created_at,updated_at,created_by)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .returns<MembershipWithOrganization[]>();

  if (error) throw toMessage("Не удалось загрузить организации пользователя", error.message);
  return data ?? [];
}

async function createDefaultProject(userId: string, organizationId: string): Promise<ProjectRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_project", {
    p_budget_planned: null,
    p_color: PROJECT_COLORS[0],
    p_currency: "EUR",
    p_description: null,
    p_due_date: null,
    p_member_ids: [userId],
    p_name: "Входящие",
    p_organization_id: organizationId,
    p_owner_id: userId,
    p_priority: "medium",
    p_start_date: null,
    p_status: "active",
  });

  if (error) throw toMessage("Не удалось создать проект по умолчанию", error.message);
  return ensureData(data, "Supabase не вернул созданный проект.");
}

async function createWorkspace(user: User): Promise<Organization> {
  const supabase = getSupabaseClient();
  const organizationId = crypto.randomUUID();
  const organizationPayload: TablesInsert<"organizations"> = {
    id: organizationId,
    name: "Моя организация",
    slug: makeOrganizationSlug(organizationId),
    created_by: user.id,
  };

  const { data: organizationData, error: organizationError } = await supabase
    .from("organizations")
    .insert(organizationPayload)
    .select()
    .single();

  if (organizationError) {
    throw toMessage("Не удалось создать организацию", organizationError.message);
  }

  const organization = ensureData(organizationData, "Supabase не вернул созданную организацию.");
  const membershipPayload: TablesInsert<"organization_members"> = {
    organization_id: organization.id,
    user_id: user.id,
    role: "owner",
    created_by: user.id,
  };

  const { error: membershipError } = await supabase
    .from("organization_members")
    .insert(membershipPayload);

  if (membershipError) {
    throw toMessage("Не удалось создать членство в организации", membershipError.message);
  }

  await createDefaultProject(user.id, organization.id);
  return mapOrganization(organization);
}

async function ensureWorkspace(user: User): Promise<Organization> {
  const memberships = await fetchMemberships(user.id);
  const membership = memberships.find((item) => item.organizations);

  if (membership?.organizations) {
    return mapOrganization(membership.organizations);
  }

  return createWorkspace(user);
}

async function fetchProjectRows(userId: string, organizationId: string): Promise<ProjectRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) throw toMessage("Не удалось загрузить проекты", error.message);
  if (data?.length) return data;

  return [await createDefaultProject(userId, organizationId)];
}

async function fetchProjectLinks(organizationId: string): Promise<ProjectLinkRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("project_links")
    .select("*")
    .eq("organization_id", organizationId);

  if (error) throw toMessage("Не удалось загрузить связи проектов", error.message);
  return data ?? [];
}

async function fetchProjectMembers(organizationId: string): Promise<ProjectMemberRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("project_members")
    .select("*")
    .eq("organization_id", organizationId);

  if (error) throw toMessage("Не удалось загрузить участников проектов", error.message);
  return data ?? [];
}

async function fetchOrganizationMembers(organizationId: string): Promise<OrganizationMember[]> {
  const supabase = getSupabaseClient();
  const { data: memberRows, error: memberError } = await supabase
    .from("organization_members")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (memberError) {
    throw toMessage("Не удалось загрузить участников организации", memberError.message);
  }

  const members = memberRows ?? [];
  const userIds = members.map((member) => member.user_id);
  if (!userIds.length) return [];

  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name,avatar_url,created_at,updated_at")
    .in("id", userIds);

  if (profileError) {
    throw toMessage("Не удалось загрузить профили участников", profileError.message);
  }

  const profilesById = new Map((profileRows ?? []).map((profile) => [profile.id, profile]));
  return members.map((member) => mapOrganizationMember(member, profilesById.get(member.user_id)));
}

export async function fetchTaskLabels(organizationId: string): Promise<TaskLabel[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("task_labels")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) throw toMessage("Не удалось загрузить метки задач", error.message);
  return (data ?? []).map(mapTaskLabel);
}

async function fetchTaskIdsForLabel(organizationId: string, labelId: string): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("task_label_links")
    .select("task_id")
    .eq("organization_id", organizationId)
    .eq("label_id", labelId);

  if (error) throw toMessage("Не удалось применить фильтр по метке", error.message);
  return (data ?? []).map((link) => link.task_id);
}

async function fetchTaskRelations(
  organizationId: string,
  taskIds: string[],
): Promise<TaskRelationMaps> {
  const relations = emptyTaskRelations();
  if (!taskIds.length) return relations;

  const supabase = getSupabaseClient();
  const [
    assigneesResult,
    watchersResult,
    labelsResult,
    labelLinksResult,
    checklistResult,
    commentsResult,
    filesResult,
    transactionsResult,
  ] = await Promise.all([
    supabase
      .from("task_assignees")
      .select("*")
      .eq("organization_id", organizationId)
      .in("task_id", taskIds),
    supabase
      .from("task_watchers")
      .select("*")
      .eq("organization_id", organizationId)
      .in("task_id", taskIds),
    supabase.from("task_labels").select("*").eq("organization_id", organizationId),
    supabase
      .from("task_label_links")
      .select("*")
      .eq("organization_id", organizationId)
      .in("task_id", taskIds),
    supabase
      .from("task_checklist_items")
      .select("*")
      .eq("organization_id", organizationId)
      .in("task_id", taskIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("task_comments")
      .select("*")
      .eq("organization_id", organizationId)
      .in("task_id", taskIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("files")
      .select("*")
      .eq("organization_id", organizationId)
      .in("task_id", taskIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("finance_transactions")
      .select("*")
      .eq("organization_id", organizationId)
      .in("task_id", taskIds),
  ]);

  if (assigneesResult.error) {
    throw toMessage("Не удалось загрузить исполнителей задач", assigneesResult.error.message);
  }
  if (watchersResult.error) {
    throw toMessage("Не удалось загрузить наблюдателей задач", watchersResult.error.message);
  }
  if (labelsResult.error) {
    throw toMessage("Не удалось загрузить метки задач", labelsResult.error.message);
  }
  if (labelLinksResult.error) {
    throw toMessage("Не удалось загрузить связи меток задач", labelLinksResult.error.message);
  }
  if (checklistResult.error) {
    throw toMessage("Не удалось загрузить чек-листы задач", checklistResult.error.message);
  }
  if (commentsResult.error) {
    throw toMessage("Не удалось загрузить комментарии задач", commentsResult.error.message);
  }
  if (filesResult.error) {
    throw toMessage("Не удалось загрузить вложения задач", filesResult.error.message);
  }
  if (transactionsResult.error) {
    throw toMessage(
      "Не удалось загрузить финансовые связи задач",
      transactionsResult.error.message,
    );
  }

  (assigneesResult.data ?? []).forEach((row: TaskAssigneeRow) => {
    pushGroupedValue(relations.assigneeIdsByTask, row.task_id, row.user_id);
  });
  (watchersResult.data ?? []).forEach((row: TaskWatcherRow) => {
    pushGroupedValue(relations.watcherIdsByTask, row.task_id, row.user_id);
  });

  const labelsById = new Map(
    (labelsResult.data ?? []).map((row: TaskLabelRow) => [row.id, mapTaskLabel(row)]),
  );
  (labelLinksResult.data ?? []).forEach((row: TaskLabelLinkRow) => {
    const label = labelsById.get(row.label_id);
    if (label) pushGroupedValue(relations.labelsByTask, row.task_id, label);
  });
  (checklistResult.data ?? []).forEach((row: TaskChecklistItemRow) => {
    pushGroupedValue(relations.checklistByTask, row.task_id, mapChecklistItem(row));
  });
  (commentsResult.data ?? []).forEach((row: TaskCommentRow) => {
    pushGroupedValue(relations.commentsByTask, row.task_id, mapTaskComment(row));
  });
  (filesResult.data ?? []).forEach((row: TaskFileRow) => {
    pushGroupedValue(relations.filesByTask, row.task_id, mapTaskFile(row));
  });
  (transactionsResult.data ?? []).forEach((row: FinanceTransactionRow) => {
    if (!row.task_id) return;
    relations.financeCountByTask.set(
      row.task_id,
      (relations.financeCountByTask.get(row.task_id) ?? 0) + 1,
    );
  });

  return relations;
}

async function fetchTasks(organizationId: string, taskIds?: string[]): Promise<Task[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("tasks")
    .select("*")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .range(0, 49);

  if (taskIds) query = query.in("id", taskIds);

  const { data, error } = await query;
  if (error) throw toMessage("Не удалось загрузить задачи", error.message);

  const rows = data ?? [];
  const relations = await fetchTaskRelations(
    organizationId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapTask(row, relations));
}

export async function fetchTaskById(organizationId: string, taskId: string): Promise<Task> {
  const tasks = await fetchTasks(organizationId, [taskId]);
  const task = tasks[0];
  if (!task) throw new Error("Задача не найдена.");
  return task;
}

async function fetchTransactions(organizationId: string): Promise<Tx[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("finance_transactions")
    .select("*")
    .eq("organization_id", organizationId)
    .order("occurred_on", { ascending: false });

  if (error) throw toMessage("Не удалось загрузить финансовые операции", error.message);
  return (data ?? []).map(mapTx);
}

export async function createFinanceTransaction(
  userId: string,
  organizationId: string,
  input: FinanceTransactionInput,
): Promise<Tx> {
  const supabase = getSupabaseClient();
  const normalized = normalizeFinanceTransactionInput(input);
  const payload: TablesInsert<"finance_transactions"> = {
    organization_id: organizationId,
    created_by: userId,
    label: normalized.label,
    amount: normalized.amount,
    category: normalized.category,
    type: normalized.type,
    occurred_on: normalized.occurredOn,
    task_id: normalized.taskId,
  };

  const { data, error } = await supabase
    .from("finance_transactions")
    .insert(payload)
    .select()
    .single();
  if (error) throw toMessage("Не удалось создать финансовую операцию", error.message);
  return mapTx(ensureData(data, "Supabase не вернул созданную финансовую операцию."));
}

export async function fetchStripeTransactions(
  organizationId: string,
): Promise<StripeTransaction[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("stripe_transactions")
    .select("*")
    .eq("organization_id", organizationId)
    .order("occurred_on", { ascending: false });

  if (isMissingStripeTableError(error)) return [];
  if (error) throw toMessage("Не удалось загрузить Stripe транзакции", error.message);
  return (data ?? []).map(mapStripeTransaction);
}

export async function fetchStripeSubscriptions(
  organizationId: string,
): Promise<StripeSubscription[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("stripe_subscriptions")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (isMissingStripeTableError(error)) return [];
  if (error) throw toMessage("Не удалось загрузить Stripe подписки", error.message);
  return (data ?? []).map(mapStripeSubscription);
}

export async function fetchStripeCustomer(organizationId: string): Promise<StripeCustomer | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("stripe_customers")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (isMissingStripeTableError(error)) return null;
  if (error) throw toMessage("Не удалось загрузить Stripe клиента", error.message);
  return data ? mapStripeCustomer(data) : null;
}

export async function fetchTaskPreferences(
  organizationId: string,
  userId: string,
): Promise<TaskPreferences> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("task_view_preferences")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw toMessage("Не удалось загрузить настройки задач", error.message);
  return mapTaskPreferences(data);
}

export async function saveTaskPreferences(
  organizationId: string,
  userId: string,
  preferences: TaskPreferences,
): Promise<TaskPreferences> {
  const supabase = getSupabaseClient();
  const payload: TablesInsert<"task_view_preferences"> = {
    organization_id: organizationId,
    user_id: userId,
    selected_view: preferences.view,
    filters: taskFiltersToJson(preferences.filters),
    list_columns: preferences.listColumns,
    sort_key: preferences.sort.key,
    sort_direction: preferences.sort.direction,
    page_size: normalizePageSize(preferences.pageSize),
  };

  const { data, error } = await supabase
    .from("task_view_preferences")
    .upsert(payload, { onConflict: "organization_id,user_id" })
    .select()
    .single();

  if (error) throw toMessage("Не удалось сохранить настройки задач", error.message);
  return mapTaskPreferences(ensureData(data, "Supabase не вернул настройки задач."));
}

export async function fetchKanbanTasks(
  organizationId: string,
  filters: TaskFilters,
  limitPerStatus = 60,
): Promise<Task[]> {
  const normalizedFilters = normalizeTaskFilters(filters);
  const supabase = getSupabaseClient();
  const today = todayIsoDate();
  const search = sanitizePostgrestSearch(normalizedFilters.search);
  const labelTaskIds = normalizedFilters.tag
    ? await fetchTaskIdsForLabel(organizationId, normalizedFilters.tag)
    : null;

  if (labelTaskIds && !labelTaskIds.length) return [];

  const groupedRows = await Promise.all(
    TASK_STATUSES.map(async (status) => {
      if (normalizedFilters.status !== "all" && normalizedFilters.status !== status) return [];
      if (normalizedFilters.overdue === "overdue" && status === "completed") {
        return [];
      }

      let query = supabase
        .from("tasks")
        .select("*")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .eq("status", status)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .range(0, Math.max(0, limitPerStatus - 1));

      if (labelTaskIds) query = query.in("id", labelTaskIds);
      if (normalizedFilters.projectId === "__none") query = query.is("project_id", null);
      else if (normalizedFilters.projectId !== "all") {
        query = query.eq("project_id", normalizedFilters.projectId);
      }
      if (normalizedFilters.priority !== "all") {
        query = query.eq("priority", normalizedFilters.priority);
      }
      if (normalizedFilters.assigneeId === "__none") query = query.is("assignee_id", null);
      else if (normalizedFilters.assigneeId !== "all") {
        query = query.eq("assignee_id", normalizedFilters.assigneeId);
      }
      if (normalizedFilters.overdue === "overdue") query = query.lt("due_date", today);
      if (normalizedFilters.dateFrom) query = query.gte("due_date", normalizedFilters.dateFrom);
      if (normalizedFilters.dateTo) query = query.lte("due_date", normalizedFilters.dateTo);
      if (search) {
        query = query.or(
          `title.ilike.%${search}%,description.ilike.%${search}%,note.ilike.%${search}%`,
        );
      }

      const { data, error } = await query;
      if (error) throw toMessage("Не удалось загрузить канбан", error.message);
      return data ?? [];
    }),
  );

  const rows = groupedRows.flat();
  const relations = await fetchTaskRelations(
    organizationId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapTask(row, relations));
}

export async function fetchTasksPage(
  organizationId: string,
  queryInput: TaskQuery,
): Promise<TaskPage> {
  const filters = normalizeTaskFilters(queryInput.filters);
  const sort = normalizeTaskSort(queryInput.sort.key, queryInput.sort.direction);
  const pageSize = normalizePageSize(queryInput.pageSize);
  const page = Math.max(1, Math.round(queryInput.page));
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;
  const supabase = getSupabaseClient();
  const today = todayIsoDate();
  const search = sanitizePostgrestSearch(filters.search);
  const labelTaskIds = filters.tag ? await fetchTaskIdsForLabel(organizationId, filters.tag) : null;

  if (labelTaskIds && !labelTaskIds.length) {
    return { tasks: [], total: 0, page, pageSize };
  }

  let query = supabase
    .from("tasks")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .is("archived_at", null);

  if (labelTaskIds) query = query.in("id", labelTaskIds);
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.projectId === "__none") query = query.is("project_id", null);
  else if (filters.projectId !== "all") query = query.eq("project_id", filters.projectId);
  if (filters.priority !== "all") query = query.eq("priority", filters.priority);
  if (filters.assigneeId === "__none") query = query.is("assignee_id", null);
  else if (filters.assigneeId !== "all") query = query.eq("assignee_id", filters.assigneeId);
  if (filters.overdue === "overdue") {
    query = query.neq("status", "completed").lt("due_date", today);
  }
  if (filters.dateFrom) query = query.gte("due_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("due_date", filters.dateTo);
  if (search) {
    query = query.or(
      `title.ilike.%${search}%,description.ilike.%${search}%,note.ilike.%${search}%`,
    );
  }

  const { data, error, count } = await query
    .order(sortColumn(sort.key), { ascending: sort.direction === "asc", nullsFirst: false })
    .order("id", { ascending: sort.direction === "asc" })
    .range(rangeFrom, rangeTo);

  if (error) throw toMessage("Не удалось загрузить список задач", error.message);
  const rows = data ?? [];
  const relations = await fetchTaskRelations(
    organizationId,
    rows.map((row) => row.id),
  );

  return {
    tasks: rows.map((row) => mapTask(row, relations)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function loadCrmWorkspace(user: User): Promise<CrmSnapshot> {
  const organization = await ensureWorkspace(user);
  const projectRows = await fetchProjectRows(user.id, organization.id);
  const [
    projectLinks,
    projectMembers,
    members,
    tasks,
    taskLabels,
    txs,
    stripeTransactions,
    stripeSubscriptions,
    stripeCustomer,
  ] = await Promise.all([
    fetchProjectLinks(organization.id),
    fetchProjectMembers(organization.id),
    fetchOrganizationMembers(organization.id),
    fetchTasks(organization.id),
    fetchTaskLabels(organization.id),
    fetchTransactions(organization.id),
    fetchStripeTransactions(organization.id),
    fetchStripeSubscriptions(organization.id),
    fetchStripeCustomer(organization.id),
  ]);
  const linksByProject = new Map<string, string[]>();
  const membersByProject = new Map<string, string[]>();

  projectLinks.forEach((link) => {
    const current = linksByProject.get(link.source_project_id) ?? [];
    linksByProject.set(link.source_project_id, [...current, link.target_project_id]);
  });

  projectMembers.forEach((member) => {
    const current = membersByProject.get(member.project_id) ?? [];
    membersByProject.set(member.project_id, [...current, member.user_id]);
  });

  return {
    organization,
    members,
    projects: projectRows.map((project) =>
      mapProject(
        project,
        linksByProject.get(project.id) ?? [],
        membersByProject.get(project.id) ?? [],
      ),
    ),
    tasks,
    taskLabels,
    txs,
    stripeTransactions,
    stripeSubscriptions,
    stripeCustomer,
  };
}

type NormalizedProjectInput = {
  budgetPlanned: number | null;
  color: string;
  currency: string;
  description: string | null;
  dueDate: string | null;
  memberIds: string[];
  name: string;
  ownerId: string | null;
  priority: Project["priority"];
  startDate: string | null;
  status: Project["status"];
};

function normalizeProjectInput(
  userId: string,
  input: ProjectInput,
  fallback?: Project,
): NormalizedProjectInput {
  const hasInputValue = (key: keyof ProjectInput) => hasOwn(input, key);
  const name = input.name.trim();
  if (!name) throw new Error("Название проекта обязательно.");

  const startDate = hasInputValue("startDate")
    ? (input.startDate ?? null)
    : (fallback?.startDate ?? null);
  const dueDate = hasInputValue("dueDate") ? (input.dueDate ?? null) : (fallback?.dueDate ?? null);
  if (startDate && dueDate && dueDate < startDate) {
    throw new Error("Дата завершения не может быть раньше даты начала.");
  }

  const budgetPlanned = hasInputValue("budgetPlanned")
    ? (input.budgetPlanned ?? null)
    : (fallback?.budgetPlanned ?? null);
  if (budgetPlanned !== null && (!Number.isFinite(budgetPlanned) || budgetPlanned < 0)) {
    throw new Error("Плановый бюджет должен быть неотрицательным числом.");
  }

  const currency =
    (hasInputValue("currency") ? input.currency : (fallback?.currency ?? "EUR"))
      ?.trim()
      .toUpperCase() || "EUR";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Валюта должна быть трёхбуквенным ISO-кодом.");
  }

  const ownerId = hasInputValue("ownerId")
    ? (input.ownerId ?? userId)
    : (fallback?.ownerId ?? userId);
  const memberIds = uniqueIds([
    ...(hasInputValue("memberIds") ? (input.memberIds ?? []) : (fallback?.memberIds ?? [])),
    ownerId,
    userId,
  ]);
  const description = hasInputValue("description")
    ? input.description?.trim() || null
    : (fallback?.description ?? null);
  const color = (
    hasInputValue("color") ? input.color : (fallback?.color ?? PROJECT_COLORS[0])
  )?.trim();

  return {
    budgetPlanned,
    color: color || PROJECT_COLORS[0],
    currency,
    description,
    dueDate,
    memberIds,
    name,
    ownerId,
    priority: hasInputValue("priority")
      ? (input.priority ?? "medium")
      : (fallback?.priority ?? "medium"),
    startDate,
    status: hasInputValue("status") ? (input.status ?? "planned") : (fallback?.status ?? "planned"),
  };
}

export async function createProject(
  userId: string,
  organizationId: string,
  input: ProjectInput,
): Promise<Project> {
  const supabase = getSupabaseClient();
  const normalized = normalizeProjectInput(userId, input);

  const { data, error } = await supabase.rpc("create_project", {
    p_budget_planned: normalized.budgetPlanned,
    p_color: normalized.color,
    p_currency: normalized.currency,
    p_description: normalized.description,
    p_due_date: normalized.dueDate,
    p_member_ids: normalized.memberIds,
    p_name: normalized.name,
    p_organization_id: organizationId,
    p_owner_id: normalized.ownerId,
    p_priority: normalized.priority,
    p_start_date: normalized.startDate,
    p_status: normalized.status,
  });

  if (error) throw toMessage("Не удалось создать проект", error.message);
  return mapProject(
    ensureData(data, "Supabase не вернул созданный проект."),
    [],
    normalized.memberIds,
  );
}

export async function updateProject(
  userId: string,
  project: Project,
  patch: ProjectPatch,
): Promise<Project> {
  const supabase = getSupabaseClient();
  const normalized = normalizeProjectInput(userId, { ...project, ...patch }, project);

  const { data, error } = await supabase.rpc("update_project", {
    p_budget_planned: normalized.budgetPlanned,
    p_color: normalized.color,
    p_currency: normalized.currency,
    p_description: normalized.description,
    p_due_date: normalized.dueDate,
    p_member_ids: normalized.memberIds,
    p_name: normalized.name,
    p_owner_id: normalized.ownerId,
    p_priority: normalized.priority,
    p_project_id: project.id,
    p_start_date: normalized.startDate,
    p_status: normalized.status,
  });

  if (error) throw toMessage("Не удалось обновить проект", error.message);
  const updatedRow = ensureData(data, "Supabase не вернул обновлённый проект.");

  let nextX = project.x;
  let nextY = project.y;
  if (typeof patch.x === "number" || typeof patch.y === "number") {
    nextX = patch.x ?? project.x;
    nextY = patch.y ?? project.y;
    await supabase
      .from("projects")
      .update({ x_position: nextX, y_position: nextY })
      .eq("id", project.id);
  }

  let nextLinks = project.links;
  if (patch.links) {
    nextLinks = patch.links;
    await supabase.from("project_links").delete().eq("source_project_id", project.id);
    if (nextLinks.length > 0) {
      await supabase.from("project_links").insert(
        nextLinks.map((targetId) => ({
          organization_id: project.organizationId,
          source_project_id: project.id,
          target_project_id: targetId,
          created_by: userId,
        })),
      );
    }
  }

  return mapProject(
    { ...updatedRow, x_position: nextX, y_position: nextY },
    nextLinks,
    normalized.memberIds,
  );
}

export async function archiveProject(userId: string, project: Project): Promise<Project> {
  return updateProject(userId, project, { name: project.name, status: "archived" });
}

type NormalizedTaskInput = {
  actualMinutes: number;
  assigneeId: string | null;
  assigneeIds: string[];
  checklistTitles: string[];
  currency: string;
  description: string | null;
  dueDate: string | null;
  estimatedMinutes: number | null;
  expectedRevenue: number | null;
  internalCost: number | null;
  labelIds: string[];
  newLabelNames: string[];
  parentTaskId: string | null;
  priority: Priority;
  progress: number;
  projectId: string | null;
  sortOrder: number;
  startDate: string | null;
  status: TaskStatus;
  subtaskTitles: string[];
  tags: string[];
  title: string;
  watcherIds: string[];
  source: string;
  workflowStatus: string;
  targetRole: string | null;
  dispatchToWorkflow: boolean;
};

function normalizeTaskInput(input: Partial<TaskInput>, fallback?: Task): NormalizedTaskInput {
  const title = (input.title ?? fallback?.title ?? "").trim();
  if (!title) throw new Error("Название задачи обязательно.");

  const startDate = hasOwn(input, "startDate")
    ? (input.startDate ?? null)
    : (fallback?.startDate ?? null);
  const dueDate = hasOwn(input, "dueDate") ? (input.dueDate ?? null) : (fallback?.dueDate ?? null);
  if (startDate && dueDate && dueDate < startDate) {
    throw new Error("Дедлайн не может быть раньше даты начала.");
  }

  const description = hasOwn(input, "description")
    ? input.description?.trim() || null
    : hasOwn(input, "note")
      ? input.note?.trim() || null
      : (fallback?.description ?? null);

  const status = hasOwn(input, "status")
    ? (input.status ?? "backlog")
    : (fallback?.status ?? "backlog");
  const priority = hasOwn(input, "priority")
    ? (input.priority ?? "med")
    : (fallback?.priority ?? "med");
  const projectId = hasOwn(input, "projectId")
    ? (input.projectId ?? null)
    : (fallback?.projectId ?? null);
  const parentTaskId = hasOwn(input, "parentTaskId")
    ? (input.parentTaskId ?? null)
    : (fallback?.parentTaskId ?? null);
  const assigneeId = hasOwn(input, "assigneeId")
    ? (input.assigneeId ?? null)
    : (fallback?.assigneeId ?? null);
  const assigneeIds = uniqueIds([
    ...(hasOwn(input, "assigneeIds") ? (input.assigneeIds ?? []) : (fallback?.assigneeIds ?? [])),
    assigneeId,
  ]);
  const watcherIds = uniqueIds(
    hasOwn(input, "watcherIds") ? (input.watcherIds ?? []) : (fallback?.watcherIds ?? []),
  );
  const actualMinutes =
    normalizeIntegerMinutes(
      hasOwn(input, "actualMinutes") ? (input.actualMinutes ?? 0) : (fallback?.actualMinutes ?? 0),
      "Фактически потраченное время",
    ) ?? 0;
  const estimatedMinutes = normalizeIntegerMinutes(
    hasOwn(input, "estimatedMinutes")
      ? (input.estimatedMinutes ?? null)
      : (fallback?.estimatedMinutes ?? null),
    "Оценка длительности",
  );
  const expectedRevenue = normalizeMoney(
    hasOwn(input, "expectedRevenue")
      ? (input.expectedRevenue ?? null)
      : (fallback?.expectedRevenue ?? null),
    "Ожидаемый доход",
  );
  const internalCost = normalizeMoney(
    hasOwn(input, "internalCost") ? (input.internalCost ?? null) : (fallback?.internalCost ?? null),
    "Внутренняя стоимость",
  );
  const currency =
    (hasOwn(input, "currency") ? input.currency : (fallback?.currency ?? "EUR"))
      ?.trim()
      .toUpperCase() || "EUR";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Валюта должна быть трёхбуквенным ISO-кодом.");
  }

  const sortOrder = normalizeSortOrder(
    hasOwn(input, "sortOrder") ? (input.sortOrder ?? 0) : (fallback?.sortOrder ?? 0),
  );
  const labelIds = uniqueIds(
    hasOwn(input, "labelIds")
      ? (input.labelIds ?? [])
      : (fallback?.labels.map((label) => label.id) ?? []),
  );
  const newLabelNames = normalizeLabelNames([
    ...(input.newLabelNames ?? []),
    ...(input.tags ?? []),
  ]);
  const tags = normalizeLabelNames([
    ...(hasOwn(input, "tags") ? (input.tags ?? []) : (fallback?.tags ?? [])),
    ...newLabelNames,
  ]);

  const source = hasOwn(input, "source")
    ? String((input as Record<string, unknown>)["source"] ?? "manual")
    : (fallback?.source ?? "manual");
  const workflowStatus = hasOwn(input, "workflowStatus")
    ? String((input as Record<string, unknown>)["workflowStatus"] ?? "manual")
    : hasOwn(input, "dispatchToWorkflow") &&
        (input as Record<string, unknown>)["dispatchToWorkflow"]
      ? "pending_dispatch"
      : (fallback?.workflowStatus ?? "manual");
  const targetRole = hasOwn(input, "targetRole")
    ? (((input as Record<string, unknown>)["targetRole"] as string | null) ?? null)
    : (fallback?.targetRole ?? null);
  const dispatchToWorkflow = hasOwn(input, "dispatchToWorkflow")
    ? Boolean((input as Record<string, unknown>)["dispatchToWorkflow"])
    : (fallback?.dispatchToWorkflow ?? false);

  const rawProgress = hasOwn(input, "progress") ? (input.progress ?? 0) : (fallback?.progress ?? 0);
  const progress = Math.min(100, Math.max(0, Math.round(Number(rawProgress) || 0)));

  return {
    actualMinutes,
    assigneeId,
    assigneeIds,
    checklistTitles: normalizeLabelNames(input.checklistTitles ?? []),
    currency,
    description,
    dueDate,
    estimatedMinutes,
    expectedRevenue,
    internalCost,
    labelIds,
    newLabelNames,
    parentTaskId,
    priority,
    progress,
    projectId,
    sortOrder,
    startDate,
    status,
    subtaskTitles: normalizeLabelNames(input.subtaskTitles ?? []),
    tags,
    title,
    watcherIds,
    source,
    workflowStatus,
    targetRole,
    dispatchToWorkflow,
  };
}

function taskPayload(
  userId: string,
  organizationId: string,
  normalized: NormalizedTaskInput,
): TablesInsert<"tasks"> {
  return {
    actual_minutes: normalized.actualMinutes,
    assignee_id: normalized.assigneeId,
    author_id: userId,
    created_by: userId,
    currency: normalized.currency,
    description: normalized.description,
    due_date: normalized.dueDate,
    estimated_minutes: normalized.estimatedMinutes,
    expected_revenue: normalized.expectedRevenue,
    internal_cost: normalized.internalCost,
    note: normalized.description,
    organization_id: organizationId,
    parent_task_id: normalized.parentTaskId,
    priority: normalized.priority,
    project_id: normalized.projectId,
    sort_order: normalized.sortOrder,
    start_date: normalized.startDate,
    status: normalized.status,
    tags: normalized.tags,
    title: normalized.title,
    // dispatch extensions (cast via unknown to tolerate missing generated types until regen)
    ...({
      source: normalized.source,
      workflow_status: normalized.workflowStatus,
      target_role: normalized.targetRole,
      dispatch_to_workflow: normalized.dispatchToWorkflow,
      progress: normalized.progress,
    } as unknown as Record<string, unknown>),
  } as TablesInsert<"tasks">;
}

function taskUpdatePayload(normalized: NormalizedTaskInput): TablesUpdate<"tasks"> {
  return {
    actual_minutes: normalized.actualMinutes,
    assignee_id: normalized.assigneeId,
    currency: normalized.currency,
    description: normalized.description,
    due_date: normalized.dueDate,
    estimated_minutes: normalized.estimatedMinutes,
    expected_revenue: normalized.expectedRevenue,
    internal_cost: normalized.internalCost,
    note: normalized.description,
    parent_task_id: normalized.parentTaskId,
    priority: normalized.priority,
    project_id: normalized.projectId,
    sort_order: normalized.sortOrder,
    start_date: normalized.startDate,
    status: normalized.status,
    tags: normalized.tags,
    title: normalized.title,
    ...({
      source: normalized.source,
      workflow_status: normalized.workflowStatus,
      target_role: normalized.targetRole,
      dispatch_to_workflow: normalized.dispatchToWorkflow,
      progress: normalized.progress,
    } as unknown as Record<string, unknown>),
  } as TablesUpdate<"tasks">;
}

async function replaceTaskAssignees(
  userId: string,
  organizationId: string,
  taskId: string,
  assigneeIds: string[],
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error: deleteError } = await supabase
    .from("task_assignees")
    .delete()
    .eq("organization_id", organizationId)
    .eq("task_id", taskId);

  if (deleteError) throw toMessage("Не удалось обновить исполнителей", deleteError.message);
  if (!assigneeIds.length) return;

  const payload: TablesInsert<"task_assignees">[] = assigneeIds.map((assigneeId) => ({
    created_by: userId,
    organization_id: organizationId,
    task_id: taskId,
    user_id: assigneeId,
  }));
  const { error } = await supabase.from("task_assignees").insert(payload);
  if (error) throw toMessage("Не удалось сохранить исполнителей", error.message);
}

async function replaceTaskWatchers(
  userId: string,
  organizationId: string,
  taskId: string,
  watcherIds: string[],
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error: deleteError } = await supabase
    .from("task_watchers")
    .delete()
    .eq("organization_id", organizationId)
    .eq("task_id", taskId);

  if (deleteError) throw toMessage("Не удалось обновить наблюдателей", deleteError.message);
  if (!watcherIds.length) return;

  const payload: TablesInsert<"task_watchers">[] = watcherIds.map((watcherId) => ({
    created_by: userId,
    organization_id: organizationId,
    task_id: taskId,
    user_id: watcherId,
  }));
  const { error } = await supabase.from("task_watchers").insert(payload);
  if (error) throw toMessage("Не удалось сохранить наблюдателей", error.message);
}

async function ensureTaskLabels(
  userId: string,
  organizationId: string,
  labelNames: string[],
): Promise<TaskLabel[]> {
  const names = normalizeLabelNames(labelNames);
  if (!names.length) return [];

  const supabase = getSupabaseClient();
  const { data: existingRows, error: existingError } = await supabase
    .from("task_labels")
    .select("*")
    .eq("organization_id", organizationId);

  if (existingError) throw toMessage("Не удалось проверить метки", existingError.message);

  const byName = new Map(
    (existingRows ?? []).map((row) => [row.name.trim().toLowerCase(), mapTaskLabel(row)]),
  );
  const missing = names.filter((name) => !byName.has(name.toLowerCase()));

  if (missing.length) {
    const payload: TablesInsert<"task_labels">[] = missing.map((name, index) => ({
      color: PROJECT_COLORS[index % PROJECT_COLORS.length] ?? PROJECT_COLORS[0],
      created_by: userId,
      name,
      organization_id: organizationId,
    }));
    const { data: insertedRows, error: insertError } = await supabase
      .from("task_labels")
      .insert(payload)
      .select();

    if (insertError) throw toMessage("Не удалось создать метки", insertError.message);
    (insertedRows ?? []).forEach((row) => {
      byName.set(row.name.trim().toLowerCase(), mapTaskLabel(row));
    });
  }

  return names
    .map((name) => byName.get(name.toLowerCase()))
    .filter((label): label is TaskLabel => Boolean(label));
}

async function replaceTaskLabels(
  userId: string,
  organizationId: string,
  taskId: string,
  labelIds: string[],
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error: deleteError } = await supabase
    .from("task_label_links")
    .delete()
    .eq("organization_id", organizationId)
    .eq("task_id", taskId);

  if (deleteError) throw toMessage("Не удалось обновить метки задачи", deleteError.message);
  if (!labelIds.length) return;

  const payload: TablesInsert<"task_label_links">[] = labelIds.map((labelId) => ({
    created_by: userId,
    label_id: labelId,
    organization_id: organizationId,
    task_id: taskId,
  }));
  const { error } = await supabase.from("task_label_links").insert(payload);
  if (error) throw toMessage("Не удалось сохранить метки задачи", error.message);
}

async function persistTaskRelations(
  userId: string,
  organizationId: string,
  taskId: string,
  normalized: NormalizedTaskInput,
): Promise<void> {
  const createdLabels = await ensureTaskLabels(userId, organizationId, normalized.newLabelNames);
  const labelIds = uniqueIds([...normalized.labelIds, ...createdLabels.map((label) => label.id)]);

  await Promise.all([
    replaceTaskAssignees(userId, organizationId, taskId, normalized.assigneeIds),
    replaceTaskWatchers(userId, organizationId, taskId, normalized.watcherIds),
    replaceTaskLabels(userId, organizationId, taskId, labelIds),
  ]);
}

async function createInitialChecklistItems(
  userId: string,
  organizationId: string,
  taskId: string,
  titles: string[],
): Promise<void> {
  if (!titles.length) return;

  const supabase = getSupabaseClient();
  const payload: TablesInsert<"task_checklist_items">[] = titles.map((title, index) => ({
    created_by: userId,
    organization_id: organizationId,
    sort_order: index,
    task_id: taskId,
    title,
  }));
  const { error } = await supabase.from("task_checklist_items").insert(payload);
  if (error) throw toMessage("Не удалось создать чек-лист", error.message);
}

async function createInitialSubtasks(
  userId: string,
  organizationId: string,
  parentTaskId: string,
  normalized: NormalizedTaskInput,
): Promise<void> {
  if (!normalized.subtaskTitles.length) return;

  const supabase = getSupabaseClient();
  const payload: TablesInsert<"tasks">[] = normalized.subtaskTitles.map((title, index) => ({
    actual_minutes: 0,
    assignee_id: normalized.assigneeId,
    author_id: userId,
    created_by: userId,
    currency: normalized.currency,
    description: null,
    due_date: normalized.dueDate,
    estimated_minutes: null,
    expected_revenue: null,
    internal_cost: null,
    note: null,
    organization_id: organizationId,
    parent_task_id: parentTaskId,
    priority: normalized.priority,
    project_id: normalized.projectId,
    sort_order: normalized.sortOrder + index + 1,
    start_date: normalized.startDate,
    status: "backlog",
    tags: [],
    title,
  }));
  const { error } = await supabase.from("tasks").insert(payload);
  if (error) throw toMessage("Не удалось создать подзадачи", error.message);
}

function extractMissingColumn(message: string): string | null {
  const m =
    message.match(/Could not find the '([^']+)' column/i) ||
    message.match(/column "([^"]+)" of relation "tasks" does not exist/i);
  return m?.[1] ?? null;
}

function mapPriorityForQavf(priority: string): string {
  // qavf tasks.priority enum: low/normal/high/urgent ; CRM: low/med/high
  if (priority === "med") return "normal";
  if (priority === "high") return "high";
  if (priority === "low") return "low";
  return "normal";
}
function mapStatusForQavf(status: string): string {
  // qavf: todo/in_progress/completed/cancelled ; CRM: backlog/in_progress/review/completed
  if (status === "backlog") return "todo";
  if (status === "review") return "in_progress";
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  return "todo";
}

async function insertTaskWithFallback(
  supabase: ReturnType<typeof getSupabaseClient>,
  initialPayload: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> {
  const payload: Record<string, unknown> = { ...initialPayload };
  // Adapt common mismatches for qavf hostel schema
  if (payload["due_date"] && !payload["due_at"]) payload["due_at"] = payload["due_date"];
  if (payload["assignee_id"] && !payload["assigned_user_id"])
    payload["assigned_user_id"] = payload["assignee_id"];
  if (payload["author_id"] && !payload["created_by"]) payload["created_by"] = payload["author_id"];
  if (payload["priority"]) payload["priority"] = mapPriorityForQavf(String(payload["priority"]));
  if (payload["status"]) payload["status"] = mapStatusForQavf(String(payload["status"]));

  for (let attempt = 0; attempt < 15; attempt++) {
    const { data, error } = await supabase.from("tasks").insert(payload).select().single();
    if (!error) return { data: data as Record<string, unknown>, error: null };
    const missing = extractMissingColumn(error.message);
    if (missing && payload[missing] !== undefined) {
      // Also handle aliased columns
      const aliases: Record<string, string[]> = {
        organization_id: ["organization_id"],
        project_id: ["project_id"],
        sort_order: ["sort_order"],
        tags: ["tags"],
        priority: ["priority"],
        status: ["status"],
        due_date: ["due_date", "due_at"],
        assignee_id: ["assignee_id", "assigned_user_id"],
        author_id: ["author_id"],
      };
      // Remove the missing column; if it has alias try removing alias too
      delete payload[missing];
      if (missing === "due_date") delete payload["due_at"];
      if (missing === "due_at") delete payload["due_date"];
      if (missing === "assignee_id") delete payload["assigned_user_id"];
      if (missing === "assigned_user_id") delete payload["assignee_id"];
      continue;
    }
    // Handle enum/check-constraint violations — on check constraint, drop column to use DB default (most robust)
    if (
      error.message.includes("invalid input value for enum") ||
      error.message.includes("violates check constraint")
    ) {
      const em = error.message;
      const isCheck = em.includes("violates check constraint");
      // For check constraints, immediately drop the offending column to use DB default — avoids infinite toggle between dialects
      if (isCheck) {
        if (em.includes("tasks_status_allowed_check") || em.includes("status")) {
          if (payload["status"] !== undefined) {
            delete payload["status"];
            continue;
          }
        }
        if (em.includes("priority") || em.includes("task_priority")) {
          if (payload["priority"] !== undefined) {
            delete payload["priority"];
            continue;
          }
        }
        // Generic check: drop both if we can't tell
        if (payload["status"] !== undefined) {
          delete payload["status"];
          continue;
        }
        if (payload["priority"] !== undefined) {
          delete payload["priority"];
          continue;
        }
      }
      if (em.includes("task_priority") || (isCheck && em.includes("priority"))) {
        if (String(payload["priority"]) === "med") {
          payload["priority"] = "normal";
          continue;
        }
        if (String(payload["priority"]) === "normal") {
          payload["priority"] = "med";
          continue;
        }
        if (String(payload["priority"]) === "urgent") {
          payload["priority"] = "high";
          continue;
        }
        if (payload["priority"] !== undefined) {
          delete payload["priority"];
          continue;
        }
      }
      if (em.includes("task_status") || em.includes("tasks_status") || em.includes("status")) {
        if (String(payload["status"]) === "backlog") {
          payload["status"] = "todo";
          continue;
        }
        if (String(payload["status"]) === "todo") {
          payload["status"] = "backlog";
          continue;
        }
        if (String(payload["status"]) === "review") {
          payload["status"] = "in_progress";
          continue;
        }
        if (payload["status"] !== undefined) {
          delete payload["status"];
          continue;
        }
      }
      const enumCol = em.match(/for enum (\w+):/)?.[1];
      if (enumCol === "task_priority" && payload["priority"] !== undefined) {
        delete payload["priority"];
        continue;
      }
      if (enumCol === "task_status" && payload["status"] !== undefined) {
        delete payload["status"];
        continue;
      }
    }
    return { data: null, error };
  }
  const { data, error } = await supabase.from("tasks").insert(payload).select().single();
  return {
    data: data as Record<string, unknown> | null,
    error: error as { message: string } | null,
  };
}

export async function createTask(
  userId: string,
  organizationId: string,
  input: TaskInput,
): Promise<Task> {
  const supabase = getSupabaseClient();
  const normalized = normalizeTaskInput(input);
  const fullPayload = taskPayload(userId, organizationId, normalized) as unknown as Record<
    string,
    unknown
  >;
  const { data, error } = await insertTaskWithFallback(supabase, fullPayload);

  if (error) throw toMessage("Не удалось создать задачу", error.message);
  const created = ensureData(
    data as unknown as TaskRow,
    "Supabase не вернул созданную задачу.",
  ) as unknown as TaskRow;

  // Relations may not exist in qavf schema — ignore those errors gracefully
  try {
    await persistTaskRelations(userId, organizationId, created.id, normalized);
  } catch {
    // Ignore relation persistence failures for fallback schemas.
  }
  try {
    await createInitialChecklistItems(
      userId,
      organizationId,
      created.id,
      normalized.checklistTitles,
    );
  } catch {
    // Ignore checklist bootstrap failures for fallback schemas.
  }
  try {
    await createInitialSubtasks(userId, organizationId, created.id, normalized);
  } catch {
    // Ignore subtask bootstrap failures for fallback schemas.
  }

  try {
    return await fetchTaskById(organizationId, created.id);
  } catch {
    // Fallback: map minimal row directly if fetch with organization_id fails (qavf has no org column)
    return mapTask(created as unknown as TaskRow);
  }
}

export async function updateTask(
  userId: string,
  organizationId: string,
  id: string,
  patch: TaskPatch,
): Promise<Task> {
  const supabase = getSupabaseClient();
  let current: Task | null = null;
  try {
    current = await fetchTaskById(organizationId, id);
  } catch {
    current = null;
  }
  const normalized = normalizeTaskInput(patch, current ?? undefined);
  if (normalized.parentTaskId === id) throw new Error("Задача не может быть родителем самой себя.");

  const payload: Record<string, unknown> = taskUpdatePayload(normalized) as unknown as Record<
    string,
    unknown
  >;
  if (payload["priority"]) payload["priority"] = mapPriorityForQavf(String(payload["priority"]));
  if (payload["status"]) payload["status"] = mapStatusForQavf(String(payload["status"]));
  if (payload["due_date"] && !payload["due_at"]) payload["due_at"] = payload["due_date"];

  // Try with organization_id filter, fallback to id-only for qavf schema
  for (let attempt = 0; attempt < 12; attempt++) {
    let query = supabase.from("tasks").update(payload).eq("id", id);
    // Only add org filter if column exists (try and strip on error)
    if (attempt === 0)
      query = query.eq("organization_id" as never, organizationId as never) as typeof query;
    const { data, error } = await query.select().single();
    if (!error) {
      ensureData(data as unknown as TaskRow, "Supabase не вернул обновлённую задачу.");
      try {
        await persistTaskRelations(userId, organizationId, id, normalized);
      } catch {
        // Ignore relation persistence failures for fallback schemas.
      }
      try {
        return await fetchTaskById(organizationId, id);
      } catch {
        return mapTask(data as unknown as TaskRow);
      }
    }
    const missing = extractMissingColumn(error.message);
    if (missing && payload[missing] !== undefined) {
      delete payload[missing];
      continue;
    }
    if (
      error.message.includes("invalid input value for enum") ||
      error.message.includes("violates check constraint")
    ) {
      const em = error.message;
      const isCheck = em.includes("violates check constraint");
      // For check constraints, drop column immediately to use DB default (avoids dialect toggling)
      if (isCheck) {
        if (em.includes("tasks_status_allowed_check") || em.includes("status")) {
          if (payload["status"] !== undefined) {
            delete payload["status"];
            continue;
          }
        }
        if (em.includes("priority") || em.includes("task_priority")) {
          if (payload["priority"] !== undefined) {
            delete payload["priority"];
            continue;
          }
        }
        if (payload["status"] !== undefined) {
          delete payload["status"];
          continue;
        }
        if (payload["priority"] !== undefined) {
          delete payload["priority"];
          continue;
        }
      }
      if (em.includes("task_priority") || (isCheck && em.includes("priority"))) {
        if (String(payload["priority"]) === "med") {
          payload["priority"] = "normal";
          continue;
        }
        if (String(payload["priority"]) === "normal") {
          payload["priority"] = "med";
          continue;
        }
        if (String(payload["priority"]) === "urgent") {
          payload["priority"] = "high";
          continue;
        }
        if (payload["priority"] !== undefined) {
          delete payload["priority"];
          continue;
        }
      }
      if (em.includes("task_status") || em.includes("tasks_status") || em.includes("status")) {
        if (String(payload["status"]) === "backlog") {
          payload["status"] = "todo";
          continue;
        }
        if (String(payload["status"]) === "todo") {
          payload["status"] = "backlog";
          continue;
        }
        if (String(payload["status"]) === "review") {
          payload["status"] = "in_progress";
          continue;
        }
        if (String(payload["status"]) === "planned") {
          payload["status"] = "todo";
          continue;
        }
        if (String(payload["status"]) === "blocked") {
          payload["status"] = "in_progress";
          continue;
        }
        if (payload["status"] !== undefined) {
          delete payload["status"];
          continue;
        }
      }
    }
    if (error.message.includes("column") && error.message.includes("organization_id")) {
      // Retry without org filter
      const { data: d2, error: e2 } = await supabase
        .from("tasks")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (!e2) {
        ensureData(d2 as unknown as TaskRow, "Supabase не вернул обновлённую задачу.");
        try {
          await persistTaskRelations(userId, organizationId, id, normalized);
        } catch {
          // Ignore relation persistence failures for fallback schemas.
        }
        try {
          return await fetchTaskById(organizationId, id);
        } catch {
          return mapTask(d2 as unknown as TaskRow);
        }
      }
      throw toMessage("Не удалось обновить задачу", e2.message);
    }
    throw toMessage("Не удалось обновить задачу", error.message);
  }
  throw toMessage("Не удалось обновить задачу", "Schema fallback exhausted");
}

export async function bulkUpdateTasks(
  userId: string,
  organizationId: string,
  ids: string[],
  patch: TaskPatch,
): Promise<Task[]> {
  const uniqueTaskIds = [...new Set(ids)];
  if (!uniqueTaskIds.length) return [];

  const updated = await Promise.all(
    uniqueTaskIds.map((id) => updateTask(userId, organizationId, id, patch)),
  );
  return updated;
}

export async function archiveTask(organizationId: string, id: string): Promise<Task> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("archive_task", { p_task_id: id });

  if (error) throw toMessage("Не удалось архивировать задачу", error.message);
  ensureData(data, "Supabase не вернул архивированную задачу.");
  return fetchTaskById(organizationId, id);
}

export async function deleteTask(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("delete_task", { p_task_id: id });

  if (!error) return;
  if (error.message.includes("TASK_ARCHIVE_REQUIRED")) {
    throw new TaskArchiveRequiredError(
      "У задачи есть дочерние задачи или финансовые операции. Архивируйте её вместо удаления.",
    );
  }

  throw toMessage("Не удалось удалить задачу", error.message);
}

export async function createChecklistItem(
  userId: string,
  organizationId: string,
  taskId: string,
  title: string,
  sortOrder: number,
): Promise<TaskChecklistItem> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error("Текст пункта чек-листа обязателен.");

  const supabase = getSupabaseClient();
  const payload: TablesInsert<"task_checklist_items"> = {
    created_by: userId,
    organization_id: organizationId,
    sort_order: normalizeSortOrder(sortOrder),
    task_id: taskId,
    title: normalizedTitle,
  };
  const { data, error } = await supabase
    .from("task_checklist_items")
    .insert(payload)
    .select()
    .single();

  if (error) throw toMessage("Не удалось добавить пункт чек-листа", error.message);
  return mapChecklistItem(ensureData(data, "Supabase не вернул пункт чек-листа."));
}

export async function updateChecklistItem(
  userId: string,
  organizationId: string,
  itemId: string,
  patch: { title?: string; completed?: boolean },
): Promise<TaskChecklistItem> {
  const payload: TablesUpdate<"task_checklist_items"> = {};

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error("Текст пункта чек-листа обязателен.");
    payload.title = title;
  }
  if (patch.completed !== undefined) {
    payload.completed_at = patch.completed ? new Date().toISOString() : null;
    payload.completed_by = patch.completed ? userId : null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("task_checklist_items")
    .update(payload)
    .eq("organization_id", organizationId)
    .eq("id", itemId)
    .select()
    .single();

  if (error) throw toMessage("Не удалось обновить чек-лист", error.message);
  return mapChecklistItem(ensureData(data, "Supabase не вернул пункт чек-листа."));
}

export async function deleteChecklistItem(organizationId: string, itemId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("task_checklist_items")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", itemId);

  if (error) throw toMessage("Не удалось удалить пункт чек-листа", error.message);
}

export async function createTaskComment(
  userId: string,
  organizationId: string,
  taskId: string,
  body: string,
): Promise<TaskComment> {
  const normalizedBody = body.trim();
  if (!normalizedBody) throw new Error("Комментарий не может быть пустым.");

  const supabase = getSupabaseClient();
  const payload: TablesInsert<"task_comments"> = {
    body: normalizedBody,
    created_by: userId,
    organization_id: organizationId,
    task_id: taskId,
  };
  const { data, error } = await supabase.from("task_comments").insert(payload).select().single();

  if (error) throw toMessage("Не удалось добавить комментарий", error.message);
  return mapTaskComment(ensureData(data, "Supabase не вернул комментарий."));
}

export async function uploadTaskFile(
  userId: string,
  organizationId: string,
  taskId: string,
  file: File,
): Promise<TaskFile> {
  validateTaskFile(file);

  const supabase = getSupabaseClient();
  const storageName = `${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
  const storagePath = `${organizationId}/${taskId}/${storageName}`;
  const { error: uploadError } = await supabase.storage
    .from(TASK_FILE_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) throw toMessage("Не удалось загрузить файл", uploadError.message);

  const payload: TablesInsert<"files"> = {
    bucket_id: TASK_FILE_BUCKET,
    file_name: file.name,
    mime_type: file.type,
    organization_id: organizationId,
    size_bytes: file.size,
    storage_path: storagePath,
    task_id: taskId,
    uploaded_by: userId,
  };
  const { data, error } = await supabase.from("files").insert(payload).select().single();

  if (error) {
    await supabase.storage.from(TASK_FILE_BUCKET).remove([storagePath]);
    throw toMessage("Файл загружен, но не удалось сохранить запись вложения", error.message);
  }

  return mapTaskFile(ensureData(data, "Supabase не вернул вложение."));
}

export async function getTaskFileSignedUrl(storagePath: string): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage
    .from(TASK_FILE_BUCKET)
    .createSignedUrl(storagePath, 60 * 5);

  if (error) throw toMessage("Не удалось открыть вложение", error.message);
  return data.signedUrl;
}

// ========================================
// Lead Clients (CRM)
// ========================================

type LeadClientRow = Tables<"lead_clients">;

export type {
  LeadClient,
  LeadClientInput,
  LeadClientPatch,
  CityGroupedClients,
} from "@/types/lead";
import type {
  LeadClient,
  LeadClientInput,
  LeadClientPatch,
  CityGroupedClients,
} from "@/types/lead";

function mapLeadClient(row: LeadClientRow): LeadClient {
  return {
    id: row.id,
    businessName: row.business_name,
    category: row.category,
    cityLocation: row.city_location,
    country: row.country,
    countryFlag: row.country_flag,
    contactPhone: row.contact_phone,
    email: row.email,
    websiteUrl: row.website_url,
    whatsappStatus: row.whatsapp_status,
    googleMapsUrl: row.google_maps_url,
    priority: row.priority,
    status: row.status,
    websiteStatusType: row.website_status_type,
    aiOfferScript: row.ai_offer_script,
    sourceQuery: row.source_query,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function leadClientInputToRow(input: LeadClientInput): TablesInsert<"lead_clients"> {
  const row: TablesInsert<"lead_clients"> = {
    business_name: input.businessName,
    category: input.category,
    city_location: input.cityLocation,
    user_id: "", // Will be set by the caller
  };
  if (input.country !== undefined) row.country = input.country;
  if (input.countryFlag !== undefined) row.country_flag = input.countryFlag;
  if (input.contactPhone !== undefined) row.contact_phone = input.contactPhone;
  if (input.email !== undefined) row.email = input.email;
  if (input.websiteUrl !== undefined) row.website_url = input.websiteUrl;
  if (input.whatsappStatus !== undefined) row.whatsapp_status = input.whatsappStatus;
  if (input.googleMapsUrl !== undefined) row.google_maps_url = input.googleMapsUrl;
  if (input.priority !== undefined) row.priority = input.priority;
  if (input.status !== undefined) row.status = input.status;
  if (input.websiteStatusType !== undefined) row.website_status_type = input.websiteStatusType;
  if (input.aiOfferScript !== undefined) row.ai_offer_script = input.aiOfferScript;
  if (input.sourceQuery !== undefined) row.source_query = input.sourceQuery;
  return row;
}

export async function fetchLeadClients(
  userId: string,
  organizationId: string,
  options?: { status?: string; city?: string },
): Promise<LeadClient[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("lead_clients")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .order("city_location")
    .order("priority")
    .order("business_name");

  if (options?.status) {
    query = query.eq("status", options.status);
  }
  if (options?.city) {
    query = query.eq("city_location", options.city);
  }

  const { data, error } = await query;
  if (error) throw toMessage("Не удалось загрузить клиентов", error.message);
  return (data || []).map(mapLeadClient);
}

export async function fetchLeadClientsGroupedByCity(
  userId: string,
  organizationId: string,
  status?: string,
): Promise<CityGroupedClients[]> {
  const clients = await fetchLeadClients(userId, organizationId, { status });
  const groups = new Map<string, LeadClient[]>();
  for (const client of clients) {
    const group = groups.get(client.cityLocation) ?? [];
    group.push(client);
    groups.set(client.cityLocation, group);
  }
  return [...groups.entries()].map(([cityLocation, cityClients]) => ({
    cityLocation,
    clients: cityClients,
    clientCount: cityClients.length,
  }));
}

export async function createLeadClient(
  userId: string,
  organizationId: string,
  input: LeadClientInput,
): Promise<LeadClient> {
  const supabase = getSupabaseClient();
  const row = leadClientInputToRow(input);
  row.user_id = userId;
  row.organization_id = organizationId;

  const { data, error } = await supabase.from("lead_clients").insert(row).select().single();

  if (error) throw toMessage("Не удалось создать клиента", error.message);
  return mapLeadClient(ensureData(data, "Supabase не вернул клиента."));
}

export async function updateLeadClient(
  userId: string,
  organizationId: string,
  clientId: string,
  patch: LeadClientPatch,
): Promise<LeadClient> {
  const supabase = getSupabaseClient();
  const updateData: TablesUpdate<"lead_clients"> = {};

  if (patch.businessName !== undefined) updateData.business_name = patch.businessName;
  if (patch.category !== undefined) updateData.category = patch.category;
  if (patch.cityLocation !== undefined) updateData.city_location = patch.cityLocation;
  if (patch.country !== undefined) updateData.country = patch.country;
  if (patch.countryFlag !== undefined) updateData.country_flag = patch.countryFlag;
  if (patch.contactPhone !== undefined) updateData.contact_phone = patch.contactPhone;
  if (patch.email !== undefined) updateData.email = patch.email;
  if (patch.websiteUrl !== undefined) updateData.website_url = patch.websiteUrl;
  if (patch.whatsappStatus !== undefined) updateData.whatsapp_status = patch.whatsappStatus;
  if (patch.googleMapsUrl !== undefined) updateData.google_maps_url = patch.googleMapsUrl;
  if (patch.priority !== undefined) updateData.priority = patch.priority;
  if (patch.status !== undefined) updateData.status = patch.status;
  if (patch.websiteStatusType !== undefined)
    updateData.website_status_type = patch.websiteStatusType;
  if (patch.aiOfferScript !== undefined) updateData.ai_offer_script = patch.aiOfferScript;
  if (patch.sourceQuery !== undefined) updateData.source_query = patch.sourceQuery;

  const { data, error } = await supabase
    .from("lead_clients")
    .update(updateData)
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw toMessage("Не удалось обновить клиента", error.message);
  return mapLeadClient(ensureData(data, "Supabase не вернул клиента."));
}

export async function deleteLeadClient(
  userId: string,
  organizationId: string,
  clientId: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("lead_clients")
    .delete()
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId);

  if (error) throw toMessage("Не удалось удалить клиента", error.message);
}

export async function bulkCreateLeadClients(
  userId: string,
  organizationId: string,
  inputs: LeadClientInput[],
): Promise<LeadClient[]> {
  const supabase = getSupabaseClient();
  const rows = inputs.map((input) => {
    const row = leadClientInputToRow(input);
    row.user_id = userId;
    row.organization_id = organizationId;
    return row;
  });

  const { data, error } = await supabase.from("lead_clients").insert(rows).select();

  if (error) throw toMessage("Не удалось массово создать клиентов", error.message);
  return (data || []).map(mapLeadClient);
}
