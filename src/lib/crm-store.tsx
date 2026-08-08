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
  archiveProject as archiveRemoteProject,
  createProject,
  createTask,
  deleteTask,
  loadCrmWorkspace,
  updateProject as updateRemoteProject,
  updateTask as updateRemoteTask,
} from "@/lib/crm-repository";
import {
  initialEmails,
  type Email,
  type Organization,
  type OrganizationMember,
  type Project,
  type ProjectInput,
  type ProjectPatch,
  type Task,
  type TaskInput,
  type TaskPatch,
  type TaskStatus,
  type Tx,
} from "./crm-data";

type Store = {
  organization: Organization | null;
  members: OrganizationMember[];
  tasks: Task[];
  emails: Email[];
  txs: Tx[];
  projects: Project[];
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  flash: string | null;
  addProject: (project: ProjectInput) => Promise<Project | null>;
  updateProject: (id: string, patch: ProjectPatch) => Promise<Project | null>;
  archiveProject: (id: string) => Promise<Project | null>;
  addTask: (t: TaskInput) => Promise<Task | null>;
  updateTask: (id: string, patch: TaskPatch) => Promise<Task | null>;
  moveTask: (id: string, status: TaskStatus) => Promise<Task | null>;
  removeTask: (id: string) => Promise<boolean>;
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

export function CrmProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [emails, setEmails] = useState<Email[]>(initialEmails);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

  const load = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);
    try {
      const snapshot = await loadCrmWorkspace(user);
      setOrganization(snapshot.organization);
      setMembers(snapshot.members);
      setProjects(snapshot.projects);
      setTasks(snapshot.tasks);
      setTxs(snapshot.txs);
    } catch (unknownError) {
      setError(messageFromError(unknownError));
      setOrganization(null);
      setMembers([]);
      setProjects([]);
      setTasks([]);
      setTxs([]);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let alive = true;
    if (!user) return;

    setIsLoading(true);
    setError(null);
    loadCrmWorkspace(user)
      .then((snapshot) => {
        if (!alive) return;
        setOrganization(snapshot.organization);
        setMembers(snapshot.members);
        setProjects(snapshot.projects);
        setTasks(snapshot.tasks);
        setTxs(snapshot.txs);
      })
      .catch((unknownError: unknown) => {
        if (!alive) return;
        setError(messageFromError(unknownError));
        setOrganization(null);
        setMembers([]);
        setProjects([]);
        setTasks([]);
        setTxs([]);
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [user]);

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
      emails,
      txs,
      projects,
      isLoading,
      isMutating: pendingMutations > 0,
      error,
      flash,
      addProject: async (input) => {
        if (!user || !organization) {
          setError("Нужна активная сессия и организация.");
          return null;
        }

        return runMutation("Проект создан", async () => {
          const project = await createProject(user.id, organization.id, input);
          setProjects((prev) => [project, ...prev]);
          return project;
        });
      },
      updateProject: async (id, patch) => {
        if (!user || !organization) {
          setError("Нужна активная сессия и организация.");
          return null;
        }

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
        if (!user || !organization) {
          setError("Нужна активная сессия и организация.");
          return null;
        }

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
        if (!user || !organization) {
          setError("Нужна активная сессия и организация.");
          return null;
        }

        return runMutation("Задача сохранена", async () => {
          const defaultProjectId = projects.find((project) => !project.archivedAt)?.id ?? null;
          const task = await createTask(user.id, organization.id, defaultProjectId, input);
          setTasks((prev) => [task, ...prev]);
          return task;
        });
      },
      updateTask: async (id, patch) => {
        if (!organization) {
          setError("Организация ещё не загружена.");
          return null;
        }

        return runMutation("Задача обновлена", async () => {
          const task = await updateRemoteTask(organization.id, id, patch);
          setTasks((prev) => prev.map((item) => (item.id === id ? task : item)));
          return task;
        });
      },
      moveTask: async (id, status) => {
        if (!organization) {
          setError("Организация ещё не загружена.");
          return null;
        }

        return runMutation("Статус задачи обновлён", async () => {
          const task = await updateRemoteTask(organization.id, id, { status });
          setTasks((prev) => prev.map((item) => (item.id === id ? task : item)));
          return task;
        });
      },
      removeTask: async (id) => {
        if (!organization) {
          setError("Организация ещё не загружена.");
          return false;
        }

        const deleted = await runMutation("Задача удалена", async () => {
          await deleteTask(organization.id, id);
          setTasks((prev) => prev.filter((item) => item.id !== id));
          return true;
        });

        return deleted ?? false;
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
      emails,
      txs,
      projects,
      isLoading,
      pendingMutations,
      error,
      flash,
      user,
      theme,
      load,
      runMutation,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCrm must be used inside CrmProvider");
  return ctx;
}
