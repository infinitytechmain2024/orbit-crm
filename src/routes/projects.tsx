import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  CalendarDays,
  FolderKanban,
  Loader2,
  Pencil,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AppShell } from "@/components/crm/AppShell";
import { useCrm } from "@/lib/crm-store";
import {
  PROJECT_COLORS,
  PROJECT_PRIORITY_LABEL,
  PROJECT_PRIORITY_OPTIONS,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_OPTIONS,
  type OrganizationMember,
  type Project,
  type ProjectInput,
  type ProjectPriority,
  type ProjectStatus,
} from "@/lib/crm-data";
import { cn } from "@/lib/utils";

const CURRENCY_FLAGS: Record<string, string> = {
  EUR: "🇪🇺",
  USD: "🇺🇸",
  GBP: "🇬🇧",
  CHF: "🇨🇭",
  PLN: "🇵🇱",
  TRY: "🇹🇷",
  UAH: "🇺🇦",
};

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Проекты — Orbit CRM" },
      {
        name: "description",
        content: "Полноценное управление проектами, участниками, статусами и архивом в Orbit CRM.",
      },
      { property: "og:title", content: "Проекты — Orbit CRM" },
      { property: "og:description", content: "Проекты, участники, приоритеты и архив." },
    ],
  }),
  component: ProjectsPage,
});

type StatusFilter = ProjectStatus | "all";
type PriorityFilter = ProjectPriority | "all";

const statusTone: Record<ProjectStatus, string> = {
  planned: "bg-acc-2/12 text-acc-2",
  active: "bg-primary/12 text-primary",
  paused: "bg-acc-3/12 text-acc-3",
  completed: "bg-acc-1/12 text-acc-1",
  archived: "bg-muted text-muted-foreground",
};

const priorityTone: Record<ProjectPriority, string> = {
  low: "bg-acc-2/12 text-acc-2",
  medium: "bg-acc-3/12 text-acc-3",
  high: "bg-acc-4/12 text-acc-4",
  critical: "bg-destructive/12 text-destructive",
};

function ProjectsPage() {
  const {
    projects,
    members,
    currency,
    isLoading,
    isMutating,
    error,
    addProject,
    updateProject,
    archiveProject,
  } = useCrm();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [memberFilter, setMemberFilter] = useState<string>("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editorProject, setEditorProject] = useState<Project | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) => {
        const archivedVisible =
          includeArchived || statusFilter === "archived" || !project.archivedAt;
        const matchesQuery =
          !normalizedQuery ||
          project.name.toLowerCase().includes(normalizedQuery) ||
          (project.description ?? "").toLowerCase().includes(normalizedQuery);
        const matchesStatus = statusFilter === "all" || project.status === statusFilter;
        const matchesPriority = priorityFilter === "all" || project.priority === priorityFilter;
        const matchesMember = memberFilter === "all" || project.memberIds.includes(memberFilter);
        return archivedVisible && matchesQuery && matchesStatus && matchesPriority && matchesMember;
      }),
    [includeArchived, memberFilter, normalizedQuery, priorityFilter, projects, statusFilter],
  );

  const activeCount = projects.filter((project) => !project.archivedAt).length;
  const archivedCount = projects.length - activeCount;

  return (
    <AppShell title="Проекты" subtitle="Планы, владельцы, участники и архив">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Summary
            icon={<FolderKanban className="size-4" />}
            label="Активных"
            value={activeCount}
          />
          <Summary icon={<Archive className="size-4" />} label="В архиве" value={archivedCount} />
          <Summary icon={<Users className="size-4" />} label="Участников" value={members.length} />
        </div>

        <section className="panel p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по названию или описанию"
                className="w-full rounded-xl border border-border bg-surface-2/60 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary/60"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:flex xl:items-center">
              <FilterSelect
                value={statusFilter}
                onChange={(value) => setStatusFilter(value as StatusFilter)}
                options={[
                  ["all", "Все статусы"],
                  ...PROJECT_STATUS_OPTIONS.map(
                    (status) => [status, PROJECT_STATUS_LABEL[status]] as const,
                  ),
                ]}
              />
              <FilterSelect
                value={priorityFilter}
                onChange={(value) => setPriorityFilter(value as PriorityFilter)}
                options={[
                  ["all", "Все приоритеты"],
                  ...PROJECT_PRIORITY_OPTIONS.map(
                    (priority) => [priority, PROJECT_PRIORITY_LABEL[priority]] as const,
                  ),
                ]}
              />
              <FilterSelect
                value={memberFilter}
                onChange={setMemberFilter}
                options={[
                  ["all", "Все участники"],
                  ...members.map((member) => [member.userId, memberLabel(member)] as const),
                ]}
              />
              <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(event) => setIncludeArchived(event.target.checked)}
                  className="size-4 accent-primary"
                />
                Архив
              </label>
            </div>
            <button
              onClick={() => {
                setEditorProject(null);
                setIsCreating(true);
              }}
              disabled={isLoading || isMutating}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              <Plus className="size-4" />
              Проект
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="panel p-6 text-sm text-muted-foreground">
            Загружаю проекты и участников из Supabase…
          </div>
        ) : visibleProjects.length ? (
          <section className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Проект</th>
                    <th className="px-4 py-3">Статус</th>
                    <th className="px-4 py-3">Приоритет</th>
                    <th className="px-4 py-3">Владелец</th>
                    <th className="px-4 py-3">Участники</th>
                    <th className="px-4 py-3">Сроки</th>
                    <th className="px-4 py-3 text-right">Бюджет</th>
                    <th className="px-4 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleProjects.map((project) => (
                    <tr
                      key={project.id}
                      onClick={() => setEditorProject(project)}
                      className={cn(
                        "cursor-pointer transition hover:bg-surface-2/50",
                        project.archivedAt && "opacity-75",
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="size-3 shrink-0 rounded-full"
                            style={{ background: project.color }}
                          />
                          <div className="min-w-0">
                            <p className="font-medium">{project.name}</p>
                            <p className="max-w-72 truncate text-xs text-muted-foreground">
                              {project.description || "Без описания"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={statusTone[project.status]}>
                          {PROJECT_STATUS_LABEL[project.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={priorityTone[project.priority]}>
                          {PROJECT_PRIORITY_LABEL[project.priority]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {memberLabelById(members, project.ownerId)}
                      </td>
                      <td className="px-4 py-3">
                        <MemberStack members={members} ids={project.memberIds} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {project.startDate || project.dueDate ? (
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays className="size-3.5" />
                            {project.startDate ?? "—"} → {project.dueDate ?? "—"}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {project.budgetPlanned === null ? (
                          "—"
                        ) : (
                          <span className="inline-flex items-center justify-end gap-2">
                            <span>{project.budgetPlanned.toLocaleString("ru-RU")}</span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2/60 px-2 py-0.5 text-[11px] font-medium text-foreground">
                              <span>{CURRENCY_FLAGS[project.currency] ?? "¤"}</span>
                              <span>{project.currency}</span>
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditorProject(project);
                          }}
                          className="inline-grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground"
                          aria-label="Редактировать проект"
                        >
                          <Pencil className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <div className="panel grid min-h-72 place-items-center p-8 text-center">
            <div>
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/12 text-primary">
                <FolderKanban className="size-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">
                {projects.length ? "Проекты не найдены" : "Проекты пока не созданы"}
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {projects.length
                  ? "Измените поиск или фильтры, чтобы увидеть нужные проекты."
                  : "Создайте первый проект, назначьте владельца и участников."}
              </p>
              {!projects.length && (
                <button
                  onClick={() => setIsCreating(true)}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  <Plus className="size-4" />
                  Создать проект
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {(isCreating || editorProject) && (
        <ProjectEditor
          project={editorProject}
          members={members}
          defaultCurrency={currency}
          isMutating={isMutating}
          onClose={() => {
            setIsCreating(false);
            setEditorProject(null);
          }}
          onCreate={addProject}
          onUpdate={updateProject}
          onArchive={archiveProject}
        />
      )}
    </AppShell>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/12 text-primary">
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-3 font-display text-2xl font-semibold">{value}</p>
    </div>
  );
}

function FilterSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
    >
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

function memberLabel(member: OrganizationMember): string {
  return member.fullName || member.email || member.userId.slice(0, 8);
}

function memberLabelById(members: OrganizationMember[], userId: string | null): string {
  if (!userId) return "Не назначен";
  return memberLabel(
    members.find((member) => member.userId === userId) ?? {
      avatarUrl: null,
      email: null,
      fullName: null,
      role: "member",
      userId,
    },
  );
}

function MemberStack({ members, ids }: { members: OrganizationMember[]; ids: string[] }) {
  const selected = ids
    .map((id) => members.find((member) => member.userId === id))
    .filter((member): member is OrganizationMember => Boolean(member));

  if (!selected.length) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <div className="flex items-center">
      {selected.slice(0, 4).map((member, index) => (
        <span
          key={member.userId}
          title={memberLabel(member)}
          className="grid size-7 place-items-center rounded-full border border-surface bg-surface-2 text-[11px] font-semibold"
          style={{ marginLeft: index ? -6 : 0 }}
        >
          {memberLabel(member).charAt(0).toUpperCase()}
        </span>
      ))}
      {selected.length > 4 && (
        <span className="ml-1 text-xs text-muted-foreground">+{selected.length - 4}</span>
      )}
    </div>
  );
}

type ProjectDraft = {
  budgetPlanned: string;
  color: string;
  currency: string;
  description: string;
  dueDate: string;
  memberIds: string[];
  name: string;
  ownerId: string;
  priority: ProjectPriority;
  startDate: string;
  status: ProjectStatus;
};

function createDraft(
  project: Project | null,
  members: OrganizationMember[],
  defaultCurrency: string,
): ProjectDraft {
  const firstMemberId = members[0]?.userId ?? "";
  return {
    budgetPlanned:
      project?.budgetPlanned === null || project?.budgetPlanned === undefined
        ? ""
        : String(project.budgetPlanned),
    color: project?.color ?? PROJECT_COLORS[0],
    currency: project?.currency ?? defaultCurrency,
    description: project?.description ?? "",
    dueDate: project?.dueDate ?? "",
    memberIds: project?.memberIds.length ? project.memberIds : firstMemberId ? [firstMemberId] : [],
    name: project?.name ?? "",
    ownerId: project?.ownerId ?? firstMemberId,
    priority: project?.priority ?? "medium",
    startDate: project?.startDate ?? "",
    status: project?.status ?? "planned",
  };
}

function ProjectEditor({
  project,
  members,
  defaultCurrency,
  isMutating,
  onClose,
  onCreate,
  onUpdate,
  onArchive,
}: {
  project: Project | null;
  members: OrganizationMember[];
  defaultCurrency: string;
  isMutating: boolean;
  onClose: () => void;
  onCreate: (input: ProjectInput) => Promise<Project | null>;
  onUpdate: (id: string, patch: ProjectInput) => Promise<Project | null>;
  onArchive: (id: string) => Promise<Project | null>;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(() =>
    createDraft(project, members, defaultCurrency),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const isArchived = Boolean(project?.archivedAt);

  useEffect(() => {
    if (project) return;
    setDraft((current) =>
      current.currency === defaultCurrency ? current : { ...current, currency: defaultCurrency },
    );
  }, [defaultCurrency, project]);

  const setOwner = (ownerId: string) => {
    setDraft((current) => ({
      ...current,
      ownerId,
      memberIds: current.memberIds.includes(ownerId)
        ? current.memberIds
        : [...current.memberIds, ownerId],
    }));
  };

  const toggleMember = (userId: string) => {
    setDraft((current) => {
      if (userId === current.ownerId) return current;
      return {
        ...current,
        memberIds: current.memberIds.includes(userId)
          ? current.memberIds.filter((id) => id !== userId)
          : [...current.memberIds, userId],
      };
    });
  };

  const toInput = (): ProjectInput | null => {
    const budgetPlanned = draft.budgetPlanned.trim() ? Number(draft.budgetPlanned) : null;
    if (budgetPlanned !== null && (!Number.isFinite(budgetPlanned) || budgetPlanned < 0)) {
      setLocalError("Плановый бюджет должен быть неотрицательным числом.");
      return null;
    }

    if (draft.startDate && draft.dueDate && draft.dueDate < draft.startDate) {
      setLocalError("Дата завершения не может быть раньше даты начала.");
      return null;
    }

    if (!draft.name.trim()) {
      setLocalError("Название проекта обязательно.");
      return null;
    }

    setLocalError(null);
    return {
      budgetPlanned,
      color: draft.color,
      currency: draft.currency.trim().toUpperCase(),
      description: draft.description.trim() || null,
      dueDate: draft.dueDate || null,
      memberIds: draft.memberIds,
      name: draft.name,
      ownerId: draft.ownerId || null,
      priority: draft.priority,
      startDate: draft.startDate || null,
      status: draft.status,
    };
  };

  const save = async () => {
    if (busy || isMutating) return;
    const input = toInput();
    if (!input) return;

    setBusy(true);
    const saved = project ? await onUpdate(project.id, input) : await onCreate(input);
    setBusy(false);
    if (saved) onClose();
  };

  const archive = async () => {
    if (!project || busy || isMutating) return;
    setBusy(true);
    const archived = await onArchive(project.id);
    setBusy(false);
    if (archived) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-in zoom-in-95"
      >
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {project ? "Карточка проекта" : "Новый проект"}
            </p>
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Название проекта"
              className="mt-1 w-full bg-transparent font-display text-xl font-semibold outline-none"
            />
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {localError && (
          <div className="mt-4 rounded-xl border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {localError}
          </div>
        )}

        <textarea
          value={draft.description}
          onChange={(event) =>
            setDraft((current) => ({ ...current, description: event.target.value }))
          }
          rows={3}
          placeholder="Описание, контекст, ссылки"
          className="mt-4 w-full resize-none rounded-xl border border-border bg-surface-2/60 p-3 text-sm outline-none transition focus:border-primary/60"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Статус">
            <select
              value={draft.status}
              disabled={busy || isMutating}
              onChange={(event) =>
                setDraft((current) => ({ ...current, status: event.target.value as ProjectStatus }))
              }
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
            >
              {PROJECT_STATUS_OPTIONS.filter((status) => status !== "archived" || isArchived).map(
                (status) => (
                  <option key={status} value={status}>
                    {PROJECT_STATUS_LABEL[status]}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Приоритет">
            <select
              value={draft.priority}
              disabled={busy || isMutating}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  priority: event.target.value as ProjectPriority,
                }))
              }
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
            >
              {PROJECT_PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {PROJECT_PRIORITY_LABEL[priority]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Дата начала">
            <input
              type="date"
              value={draft.startDate}
              disabled={busy || isMutating}
              onChange={(event) =>
                setDraft((current) => ({ ...current, startDate: event.target.value }))
              }
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
            />
          </Field>
          <Field label="Дата завершения">
            <input
              type="date"
              value={draft.dueDate}
              disabled={busy || isMutating}
              onChange={(event) =>
                setDraft((current) => ({ ...current, dueDate: event.target.value }))
              }
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Владелец">
            <select
              value={draft.ownerId}
              disabled={busy || isMutating || !members.length}
              onChange={(event) => setOwner(event.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
            >
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {memberLabel(member)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Плановый бюджет">
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.budgetPlanned}
              disabled={busy || isMutating}
              onChange={(event) =>
                setDraft((current) => ({ ...current, budgetPlanned: event.target.value }))
              }
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
            />
          </Field>
          <Field label="Валюта">
            <input
              value={draft.currency}
              maxLength={3}
              disabled={busy || isMutating}
              onChange={(event) =>
                setDraft((current) => ({ ...current, currency: event.target.value }))
              }
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm uppercase outline-none"
            />
          </Field>
        </div>

        <div className="mt-4">
          <span className="mb-2 block text-[11px] uppercase tracking-wide text-muted-foreground">
            Цвет
          </span>
          <div className="flex flex-wrap gap-2">
            {PROJECT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, color }))}
                className={cn(
                  "size-8 rounded-full border transition",
                  draft.color === color
                    ? "border-foreground ring-2 ring-primary/40"
                    : "border-border",
                )}
                style={{ background: color }}
                aria-label="Выбрать цвет проекта"
              />
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Участники
            </span>
            <span className="text-xs text-muted-foreground">{draft.memberIds.length} выбрано</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {members.map((member) => {
              const checked =
                draft.memberIds.includes(member.userId) || draft.ownerId === member.userId;
              return (
                <label
                  key={member.userId}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy || isMutating || draft.ownerId === member.userId}
                    onChange={() => toggleMember(member.userId)}
                    className="size-4 accent-primary"
                  />
                  <span className="grid size-7 place-items-center rounded-lg bg-primary/12 text-xs font-semibold text-primary">
                    {memberLabel(member).charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{memberLabel(member)}</span>
                  {draft.ownerId === member.userId && (
                    <span className="text-[11px] text-muted-foreground">Владелец</span>
                  )}
                </label>
              );
            })}
            {!members.length && (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground sm:col-span-2">
                Участники организации ещё не загружены.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {project && !isArchived && (
              <button
                onClick={() => setConfirmArchive(true)}
                disabled={busy || isMutating}
                className="inline-flex items-center gap-2 rounded-xl border border-destructive/35 px-3 py-2 text-sm text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
              >
                <Archive className="size-4" />
                Архивировать
              </button>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={busy || isMutating}
              className="rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-surface-2 disabled:opacity-60"
            >
              Отмена
            </button>
            <button
              onClick={() => void save()}
              disabled={busy || isMutating || !draft.name.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {(busy || isMutating) && <Loader2 className="size-4 animate-spin" />}
              {project ? "Сохранить" : "Создать"}
            </button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent className="border-border bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Архивировать проект?</AlertDialogTitle>
            <AlertDialogDescription>
              Проект останется доступен для просмотра в архиве, но исчезнет из активного списка и
              выбора по умолчанию.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy || isMutating}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void archive()}
              disabled={busy || isMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Архивировать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
