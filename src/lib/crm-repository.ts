import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import type { Organization, Project, Task, TaskInput, TaskPatch, Tx } from "./crm-data";

type OrganizationRow = Tables<"organizations">;
type OrganizationMemberRow = Tables<"organization_members">;
type ProjectRow = Tables<"projects">;
type ProjectLinkRow = Tables<"project_links">;
type TaskRow = Tables<"tasks">;
type FinanceTransactionRow = Tables<"finance_transactions">;

type MembershipWithOrganization = OrganizationMemberRow & {
  organizations: OrganizationRow | null;
};

export type CrmSnapshot = {
  organization: Organization;
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

function mapProject(row: ProjectRow, links: string[]): Project {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    x: Number(row.x_position),
    y: Number(row.y_position),
    links,
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
  const payload: TablesInsert<"projects"> = {
    organization_id: organizationId,
    name: "Входящие",
    color: "var(--acc-1)",
    x_position: 50,
    y_position: 50,
    created_by: userId,
  };

  const { data, error } = await supabase.from("projects").insert(payload).select().single();
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
  const [projectRows, projectLinks, tasks, txs] = await Promise.all([
    fetchProjectRows(user.id, organization.id),
    fetchProjectLinks(organization.id),
    fetchTasks(organization.id),
    fetchTransactions(organization.id),
  ]);
  const linksByProject = new Map<string, string[]>();

  projectLinks.forEach((link) => {
    const current = linksByProject.get(link.source_project_id) ?? [];
    linksByProject.set(link.source_project_id, [...current, link.target_project_id]);
  });

  return {
    organization,
    projects: projectRows.map((project) => mapProject(project, linksByProject.get(project.id) ?? [])),
    tasks,
    txs,
  };
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
