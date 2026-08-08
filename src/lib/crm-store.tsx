import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import {
  createTask,
  deleteTask,
  loadCrmWorkspace,
  updateTask as updateRemoteTask,
} from "@/lib/crm-repository";
import {
  initialEmails,
  type Email,
  type Organization,
  type Project,
  type Task,
  type TaskInput,
  type TaskPatch,
  type TaskStatus,
  type Tx,
} from "./crm-data";

type Store = {
  organization: Organization | null;
  tasks: Task[];
  emails: Email[];
  txs: Tx[];
  projects: Project[];
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  flash: string | null;
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

  const showFlash = (message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(null), 2600);
  };

  const load = async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);
    try {
      const snapshot = await loadCrmWorkspace(user);
      setOrganization(snapshot.organization);
      setProjects(snapshot.projects);
      setTasks(snapshot.tasks);
      setTxs(snapshot.txs);
    } catch (unknownError) {
      setError(messageFromError(unknownError));
      setOrganization(null);
      setProjects([]);
      setTasks([]);
      setTxs([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    if (!user) return;

    setIsLoading(true);
    setError(null);
    loadCrmWorkspace(user)
      .then((snapshot) => {
        if (!alive) return;
        setOrganization(snapshot.organization);
        setProjects(snapshot.projects);
        setTasks(snapshot.tasks);
        setTxs(snapshot.txs);
      })
      .catch((unknownError: unknown) => {
        if (!alive) return;
        setError(messageFromError(unknownError));
        setOrganization(null);
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

  const runMutation = async <T,>(successMessage: string, action: () => Promise<T>): Promise<T | null> => {
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
  };

  const value = useMemo<Store>(
    () => ({
      organization,
      tasks,
      emails,
      txs,
      projects,
      isLoading,
      isMutating: pendingMutations > 0,
      error,
      flash,
      addTask: async (input) => {
        if (!user || !organization) {
          setError("Нужна активная сессия и организация.");
          return null;
        }

        return runMutation("Задача сохранена", async () => {
          const task = await createTask(user.id, organization.id, projects[0]?.id ?? null, input);
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
        setEmails((prev) => prev.map((email) => (email.id === id ? { ...email, unread: false } : email))),
      refresh: load,
      clearError: () => setError(null),
      clearFlash: () => setFlash(null),
      theme,
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
    [
      organization,
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
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCrm must be used inside CrmProvider");
  return ctx;
}
