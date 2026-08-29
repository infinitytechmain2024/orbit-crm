import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth";
import {
  archiveTask as archiveRemoteTask,
  archiveProject as archiveRemoteProject,
  createChecklistItem as createRemoteChecklistItem,
  createFinanceTransaction as createRemoteFinanceTransaction,
  createProject,
  createTask,
  createTaskComment as createRemoteTaskComment,
  deleteChecklistItem as deleteRemoteChecklistItem,
  deleteTask,
  fetchTaskById,
  getTaskFileSignedUrl,
  loadCrmWorkspace,
  updateChecklistItem as updateRemoteChecklistItem,
  updateProject as updateRemoteProject,
  updateTask as updateRemoteTask,
  uploadTaskFile as uploadRemoteTaskFile,
  type CrmSnapshot,
  type FinanceTransactionInput,
} from "@/lib/crm-repository";
import { fetchEmails } from "@/lib/agentmail";
import {
  type Email,
  type Organization,
  type OrganizationMember,
  type Project,
  type ProjectInput,
  type ProjectPatch,
  type Task,
  type TaskChecklistItem,
  type TaskComment,
  type TaskFile,
  type TaskInput,
  type TaskLabel,
  type TaskPatch,
  type TaskStatus,
  type Tx,
  type StripeTransaction,
  type StripeSubscription,
  type StripeCustomer,
} from "./crm-data";

type Store = {
  organization: Organization | null;
  members: OrganizationMember[];
  tasks: Task[];
  taskLabels: TaskLabel[];
  emails: Email[];
  txs: Tx[];
  projects: Project[];
  stripeTransactions: StripeTransaction[];
  stripeSubscriptions: StripeSubscription[];
  stripeCustomer: StripeCustomer | null;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  flash: string | null;
  addProject: (project: ProjectInput) => Promise<Project | null>;
  updateProject: (id: string, patch: ProjectPatch) => Promise<Project | null>;
  archiveProject: (id: string) => Promise<Project | null>;
  addTask: (t: TaskInput) => Promise<Task | null>;
  updateTask: (id: string, patch: TaskPatch) => Promise<Task | null>;
  moveTask: (id: string, status: TaskStatus, position?: number) => Promise<Task | null>;
  archiveTask: (id: string) => Promise<Task | null>;
  removeTask: (id: string) => Promise<boolean>;
  refreshTask: (id: string) => Promise<Task | null>;
  addChecklistItem: (taskId: string, title: string) => Promise<TaskChecklistItem | null>;
  updateChecklistItem: (
    taskId: string,
    itemId: string,
    patch: { title?: string; completed?: boolean },
  ) => Promise<TaskChecklistItem | null>;
  deleteChecklistItem: (taskId: string, itemId: string) => Promise<boolean>;
  addTaskComment: (taskId: string, body: string) => Promise<TaskComment | null>;
  addFinanceTransaction: (input: FinanceTransactionInput) => Promise<Tx | null>;
  uploadTaskFile: (taskId: string, file: File) => Promise<TaskFile | null>;
  openTaskFile: (storagePath: string) => Promise<string | null>;
  markRead: (id: string) => void;
  refresh: () => Promise<void>;
  clearError: () => void;
  clearFlash: () => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
};

const Ctx = createContext<Store | null>(null);

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Не удалось выполнить действие.";
}

export function CrmProvider({
  children,
  previewSnapshot,
}: {
  children: ReactNode;
  previewSnapshot?: CrmSnapshot;
}) {
  const { user } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(
    previewSnapshot?.organization ?? null,
  );
  const [members, setMembers] = useState<OrganizationMember[]>(previewSnapshot?.members ?? []);
  const [tasks, setTasks] = useState<Task[]>(previewSnapshot?.tasks ?? []);
  const [taskLabels, setTaskLabels] = useState<TaskLabel[]>(previewSnapshot?.taskLabels ?? []);
  const [emails, setEmails] = useState<Email[]>([]);
  const [txs, setTxs] = useState<Tx[]>(previewSnapshot?.txs ?? []);
  const [projects, setProjects] = useState<Project[]>(previewSnapshot?.projects ?? []);
  const [stripeTransactions, setStripeTransactions] = useState<StripeTransaction[]>(
    previewSnapshot?.stripeTransactions ?? [],
  );
  const [stripeSubscriptions, setStripeSubscriptions] = useState<StripeSubscription[]>(
    previewSnapshot?.stripeSubscriptions ?? [],
  );
  const [stripeCustomer, setStripeCustomer] = useState<StripeCustomer | null>(
    previewSnapshot?.stripeCustomer ?? null,
  );
  const [isLoading, setIsLoading] = useState(!previewSnapshot);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
  }, [theme]);

  const showFlash = useCallback((message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(null), 2600);
  }, []);

  const applySnapshot = useCallback((snapshot: Awaited<ReturnType<typeof loadCrmWorkspace>>) => {
    setOrganization(snapshot.organization);
    setMembers(snapshot.members);
    setProjects(snapshot.projects);
    setTasks(snapshot.tasks);
    setTaskLabels(snapshot.taskLabels);
    setTxs(snapshot.txs);
    setStripeTransactions(snapshot.stripeTransactions);
    setStripeSubscriptions(snapshot.stripeSubscriptions);
    setStripeCustomer(snapshot.stripeCustomer);
  }, []);

  const replaceTask = useCallback((task: Task) => {
    setTasks((prev) =>
      prev.some((item) => item.id === task.id)
        ? prev.map((item) => (item.id === task.id ? task : item))
        : [task, ...prev],
    );
  }, []);

  const load = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);
    try {
      const snapshot = await loadCrmWorkspace(user);
      applySnapshot(snapshot);
    } catch (unknownError) {
      setError(messageFromError(unknownError));
      setOrganization(null);
      setMembers([]);
      setProjects([]);
      setTasks([]);
      setTaskLabels([]);
      setTxs([]);
      setStripeTransactions([]);
      setStripeSubscriptions([]);
      setStripeCustomer(null);
    } finally {
      setIsLoading(false);
    }
  }, [applySnapshot, user]);

  useEffect(() => {
    if (previewSnapshot) return;
    let alive = true;
    if (!user) return;

    setIsLoading(true);
    setError(null);
    loadCrmWorkspace(user)
      .then((snapshot) => {
        if (!alive) return;
        applySnapshot(snapshot);
      })
      .catch((unknownError: unknown) => {
        if (!alive) return;
        setError(messageFromError(unknownError));
        setOrganization(null);
        setMembers([]);
        setProjects([]);
        setTasks([]);
        setTaskLabels([]);
        setTxs([]);
        setStripeTransactions([]);
        setStripeSubscriptions([]);
        setStripeCustomer(null);
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [applySnapshot, previewSnapshot, user]);

  useEffect(() => {
    let alive = true;
    if (!organization) {
      setEmails([]);
      return;
    }
    fetchEmails(organization.id)
      .then((fetched) => {
        if (!alive) return;
        setEmails(fetched);
      })
      .catch(() => {
        if (alive) setEmails([]);
      });
    return () => {
      alive = false;
    };
  }, [organization]);

  const runMutation = useCallback(
    async <T,>(successMessage: string, action: () => Promise<T>): Promise<T | null> => {
      setPendingMutations((count) => count + 1);
      setError(null);
      try {
        const result = await action();
        showFlash(successMessage);
        return result;
      } catch (unknownError) {
        setError(messageFromError(unknownError));
        return null;
      } finally {
        setPendingMutations((count) => Math.max(0, count - 1));
      }
    },
    [showFlash],
  );

  const value = useMemo<Store>(
    () => ({
      organization,
      members,
      tasks,
      taskLabels,
      emails,
      txs,
      projects,
      stripeTransactions,
      stripeSubscriptions,
      stripeCustomer,
      isLoading,
      isMutating: pendingMutations > 0,
      error,
      flash,
      addProject: async (input) => {
        if (!user || !organization) return null;

        return runMutation("Проект создан", async () => {
          const project = await createProject(user.id, organization.id, input);
          setProjects((prev) => [project, ...prev]);
          return project;
        });
      },
      updateProject: async (id, patch) => {
        if (!user || !organization) return null;

        const project = projects.find((item) => item.id === id);
        if (!project) {
          setError("Проект не найден.");
          return null;
        }

        return runMutation("Проект обновлён", async () => {
          const updatedProject = await updateRemoteProject(user.id, project, patch);
          setProjects((prev) =>
            prev.map((item) => (item.id === updatedProject.id ? updatedProject : item)),
          );
          return updatedProject;
        });
      },
      archiveProject: async (id) => {
        if (!user || !organization) return null;

        const project = projects.find((item) => item.id === id);
        if (!project) {
          setError("Проект не найден.");
          return null;
        }

        return runMutation("Проект перемещён в архив", async () => {
          const archivedProject = await archiveRemoteProject(user.id, project);
          setProjects((prev) =>
            prev.map((item) => (item.id === archivedProject.id ? archivedProject : item)),
          );
          return archivedProject;
        });
      },
      addTask: async (input) => {
        if (!user || !organization) return null;

        return runMutation("Задача сохранена", async () => {
          const task = await createTask(user.id, organization.id, {
            ...input,
            progress: input.progress ?? 5,
          });
          const snapshot = await loadCrmWorkspace(user);
          applySnapshot(snapshot);
          return task;
        });
      },
      updateTask: async (id, patch) => {
        if (!user || !organization) return null;

        return runMutation("Задача обновлена", async () => {
          const task = await updateRemoteTask(user.id, organization.id, id, patch);
          replaceTask(task);
          return task;
        });
      },
      moveTask: async (id, status, position) => {
        if (!user || !organization) return null;

        return runMutation("Статус задачи обновлён", async () => {
          const patch: TaskPatch = { status };
          if (position !== undefined) patch.sortOrder = position;
          const task = await updateRemoteTask(user.id, organization.id, id, patch);
          replaceTask(task);
          return task;
        });
      },
      archiveTask: async (id) => {
        if (!organization) return null;

        return runMutation("Задача архивирована", async () => {
          const task = await archiveRemoteTask(organization.id, id);
          replaceTask(task);
          return task;
        });
      },
      removeTask: async (id) => {
        if (!organization) return false;

        const deleted = await runMutation("Задача удалена", async () => {
          await deleteTask(id);
          setTasks((prev) => prev.filter((item) => item.id !== id));
          return true;
        });

        return deleted ?? false;
      },
      refreshTask: async (id) => {
        if (!organization) return null;

        try {
          const task = await fetchTaskById(organization.id, id);
          replaceTask(task);
          return task;
        } catch (unknownError) {
          setError(messageFromError(unknownError));
          return null;
        }
      },
      addChecklistItem: async (taskId, title) => {
        if (!user || !organization) return null;

        return runMutation("Пункт чек-листа добавлен", async () => {
          const task = tasks.find((item) => item.id === taskId);
          const item = await createRemoteChecklistItem(
            user.id,
            organization.id,
            taskId,
            title,
            task?.checklistItems.length ?? 0,
          );
          const freshTask = await fetchTaskById(organization.id, taskId);
          replaceTask(freshTask);
          return item;
        });
      },
      updateChecklistItem: async (taskId, itemId, patch) => {
        if (!user || !organization) return null;

        return runMutation("Чек-лист обновлён", async () => {
          const item = await updateRemoteChecklistItem(user.id, organization.id, itemId, patch);
          const freshTask = await fetchTaskById(organization.id, taskId);
          replaceTask(freshTask);
          return item;
        });
      },
      deleteChecklistItem: async (taskId, itemId) => {
        if (!organization) return false;

        const deleted = await runMutation("Пункт чек-листа удалён", async () => {
          await deleteRemoteChecklistItem(organization.id, itemId);
          const freshTask = await fetchTaskById(organization.id, taskId);
          replaceTask(freshTask);
          return true;
        });

        return deleted ?? false;
      },
      addTaskComment: async (taskId, body) => {
        if (!user || !organization) return null;

        return runMutation("Комментарий добавлен", async () => {
          const comment = await createRemoteTaskComment(user.id, organization.id, taskId, body);
          const freshTask = await fetchTaskById(organization.id, taskId);
          replaceTask(freshTask);
          return comment;
        });
      },
      addFinanceTransaction: async (input) => {
        if (!user || !organization) return null;

        return runMutation("Финансовая операция сохранена", async () => {
          const tx = await createRemoteFinanceTransaction(user.id, organization.id, input);
          setTxs((prev) => [tx, ...prev]);
          return tx;
        });
      },
      uploadTaskFile: async (taskId, file) => {
        if (!user || !organization) return null;

        return runMutation("Файл загружен", async () => {
          const uploaded = await uploadRemoteTaskFile(user.id, organization.id, taskId, file);
          const freshTask = await fetchTaskById(organization.id, taskId);
          replaceTask(freshTask);
          return uploaded;
        });
      },
      openTaskFile: async (storagePath) => {
        const url = await runMutation("Ссылка на файл готова", async () =>
          getTaskFileSignedUrl(storagePath),
        );
        return url;
      },
      markRead: (id) =>
        setEmails((prev) =>
          prev.map((email) => (email.id === id ? { ...email, unread: false } : email)),
        ),
      refresh: load,
      clearError: () => setError(null),
      clearFlash: () => setFlash(null),
      theme,
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
    [
      organization,
      members,
      tasks,
      taskLabels,
      emails,
      txs,
      projects,
      stripeTransactions,
      stripeSubscriptions,
      stripeCustomer,
      isLoading,
      pendingMutations,
      error,
      flash,
      user,
      theme,
      load,
      runMutation,
      applySnapshot,
      replaceTask,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCrm must be used inside CrmProvider");
  return ctx;
}
