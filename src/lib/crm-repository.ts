import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import {
  PROJECT_COLORS,
  type Organization,
  type OrganizationMember,
  type Project,
  type ProjectInput,
  type ProjectPatch,
  type Task,
  type TaskInput,
  type TaskPatch,
  type Tx,
} from "./crm-data";

type OrganizationRow = Tables<"organizations">;
type OrganizationMemberRow = Tables<"organization_members">;
type ProfileRow = Tables<"profiles">;
type ProjectRow = Tables<"projects">;
type ProjectLinkRow = Tables<"project_links">;
type ProjectMemberRow = Tables<"project_members">;
type TaskRow = Tables<"tasks">;
type FinanceTransactionRow = Tables<"finance_transactions">;

type MembershipWithOrganization = OrganizationMemberRow & {
  organizations: OrganizationRow | null;
};

export type CrmSnapshot = {
  organization: Organization;
  members: OrganizationMember[];
  projects: Project[];
  tasks: Task[];
  txs: Tx[];
};

const dateLabelFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
});

function ensureData<T>(data: T | null, message: string): T {
  if (data === null) throw new Error(message);
  return data;
}

function toMessage(message: string, errorMessage: string): Error {
  return new Error(`${message}: ${errorMessage}`);
}

function makeOrganizationSlug(id: string): string {
  return `orbit-${id.slice(0, 8).toLowerCase()}`;
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

function mapTask(row: TaskRow): Task {
  const task: Task = {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    projectId: row.project_id,
    tags: row.tags,
  };

  if (row.note !== null) task.note = row.note;
  if (row.due_date) {
    task.dueDate = row.due_date;
    task.due = dateLabelFormatter.format(new Date(`${row.due_date}T00:00:00`));
  }

  return task;
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

async function fetchTasks(organizationId: string): Promise<Task[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw toMessage("Не удалось загрузить задачи", error.message);
  return (data ?? []).map(mapTask);
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

export async function loadCrmWorkspace(user: User): Promise<CrmSnapshot> {
  const organization = await ensureWorkspace(user);
  const projectRows = await fetchProjectRows(user.id, organization.id);
  const [projectLinks, projectMembers, members, tasks, txs] = await Promise.all([
    fetchProjectLinks(organization.id),
    fetchProjectMembers(organization.id),
    fetchOrganizationMembers(organization.id),
    fetchTasks(organization.id),
    fetchTransactions(organization.id),
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
    txs,
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

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

function normalizeProjectInput(
  userId: string,
  input: ProjectInput,
  fallback?: Project,
): NormalizedProjectInput {
  const hasInputValue = (key: keyof ProjectInput) =>
    Object.prototype.hasOwnProperty.call(input, key);
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
  return mapProject(
    ensureData(data, "Supabase не вернул обновлённый проект."),
    project.links,
    normalized.memberIds,
  );
}

export async function archiveProject(userId: string, project: Project): Promise<Project> {
  return updateProject(userId, project, { name: project.name, status: "archived" });
}

export async function createTask(
  userId: string,
  organizationId: string,
  defaultProjectId: string | null,
  input: TaskInput,
): Promise<Task> {
  const supabase = getSupabaseClient();
  const title = input.title.trim();
  if (!title) throw new Error("Название задачи не может быть пустым.");

  const payload: TablesInsert<"tasks"> = {
    organization_id: organizationId,
    project_id: input.projectId ?? defaultProjectId,
    title,
    note: input.note?.trim() || null,
    status: input.status ?? "inbox",
    priority: input.priority ?? "med",
    due_date: input.dueDate ?? null,
    tags: input.tags ?? [],
    created_by: userId,
  };

  const { data, error } = await supabase.from("tasks").insert(payload).select().single();
  if (error) throw toMessage("Не удалось создать задачу", error.message);
  return mapTask(ensureData(data, "Supabase не вернул созданную задачу."));
}

export async function updateTask(
  organizationId: string,
  id: string,
  patch: TaskPatch,
): Promise<Task> {
  const supabase = getSupabaseClient();
  const payload: TablesUpdate<"tasks"> = {};

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error("Название задачи не может быть пустым.");
    payload.title = title;
  }
  if (patch.note !== undefined) payload.note = patch.note?.trim() || null;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.projectId !== undefined) payload.project_id = patch.projectId;
  if (patch.dueDate !== undefined) payload.due_date = patch.dueDate ?? null;
  if (patch.tags !== undefined) payload.tags = patch.tags;

  const { data, error } = await supabase
    .from("tasks")
    .update(payload)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select()
    .single();

  if (error) throw toMessage("Не удалось обновить задачу", error.message);
  return mapTask(ensureData(data, "Supabase не вернул обновлённую задачу."));
}

export async function deleteTask(organizationId: string, id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", id);

  if (error) throw toMessage("Не удалось удалить задачу", error.message);
}
