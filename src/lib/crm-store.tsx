import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  initialEmails,
  initialTasks,
  initialTx,
  projects as seedProjects,
  type Email,
  type Task,
  type TaskStatus,
  type Tx,
} from "./crm-data";

type Store = {
  tasks: Task[];
  emails: Email[];
  txs: Tx[];
  projects: typeof seedProjects;
  addTask: (t: Partial<Task> & { title: string }) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  moveTask: (id: string, status: TaskStatus) => void;
  removeTask: (id: string) => void;
  markRead: (id: string) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
};

const Ctx = createContext<Store | null>(null);

const uid = () => Math.random().toString(36).slice(2, 9);

export function CrmProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [emails, setEmails] = useState<Email[]>(initialEmails);
  const [txs] = useState<Tx[]>(initialTx);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
  }, [theme]);

  const value = useMemo<Store>(
    () => ({
      tasks,
      emails,
      txs,
      projects: seedProjects,
      addTask: (t) => {
        const task: Task = {
          id: uid(),
          status: "inbox",
          priority: "med",
          projectId: "p1",
          tags: [],
          ...t,
        };
        setTasks((prev) => [task, ...prev]);
        return task;
      },
      updateTask: (id, patch) =>
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))),
      moveTask: (id, status) =>
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t))),
      removeTask: (id) => setTasks((prev) => prev.filter((t) => t.id !== id)),
      markRead: (id) =>
        setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, unread: false } : e))),
      theme,
      toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    }),
    [tasks, emails, txs, theme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCrm must be used inside CrmProvider");
  return ctx;
}
