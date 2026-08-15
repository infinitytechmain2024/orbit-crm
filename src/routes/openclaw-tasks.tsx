import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, Send, CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";

import { AppShell } from "@/components/crm/AppShell";

export const Route = createFileRoute("/openclaw-tasks")({
  head: () => ({
    meta: [
      { title: "OpenClaw Tasks — Orbit CRM" },
      { name: "description", content: "Create and monitor AI tasks via OpenClaw" },
    ],
  }),
  component: OpenClawTasksPage,
});

interface OpenClawTask {
  id: string;
  title: string;
  description: string;
  status: string;
  result: any;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  queued: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  processing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

const statusIcons: Record<string, typeof Send> = {
  pending: Clock,
  queued: Clock,
  processing: Loader2,
  completed: CheckCircle2,
  error: XCircle,
  cancelled: XCircle,
};

function OpenClawTasksPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tasks, setTasks] = useState<OpenClawTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<OpenClawTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchTasks = async () => {
    try {
      const response = await fetch("/api/openclaw/tasks?limit=20");
      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks || []);
      }
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      setFetching(false);
    }
  };

  const fetchTaskStatus = async (taskId: string) => {
    try {
      const response = await fetch(`/api/openclaw/tasks/status/${taskId}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedTask(data);
        return data.status;
      }
    } catch (error) {
      console.error("Failed to fetch task status:", error);
    }
    return null;
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    if (selectedTask && ["queued", "processing"].includes(selectedTask.status)) {
      pollingRef.current = setInterval(async () => {
        const status = await fetchTaskStatus(selectedTask.id);
        if (status && !["queued", "processing"].includes(status)) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          fetchTasks();
        }
      }, 3000);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [selectedTask?.id, selectedTask?.status]);

  const createTask = async () => {
    if (!title.trim()) return;

    setLoading(true);
    try {
      const response = await fetch("/api/openclaw/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });

      if (response.ok) {
        const data = await response.json();
        setTitle("");
        setDescription("");
        fetchTasks();
        fetchTaskStatus(data.task_id);
      }
    } catch (error) {
      console.error("Failed to create task:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell
      title="OpenClaw Tasks"
      subtitle="Create and monitor AI tasks"
    >
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Create Task Form */}
        <div className="lg:col-span-1">
          <div className="panel p-6">
            <h2 className="text-lg font-semibold mb-4">New Task</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input
                  type="text"
                  placeholder="Task title"
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createTask()}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  placeholder="Describe the task for AI..."
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 min-h-[120px] resize-y"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                onClick={createTask}
                disabled={loading || !title.trim()}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {loading ? "Sending..." : "Create Task"}
              </button>
            </div>
          </div>

          {/* Task Detail */}
          {selectedTask && (
            <div className="panel p-6 mt-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Task Details</h2>
                <button
                  className="text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedTask(null)}
                >
                  Close
                </button>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Title:</span>
                  <p className="font-medium">{selectedTask.title}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[selectedTask.status] || ""}`}>
                    {(() => {
                      const Icon = statusIcons[selectedTask.status] || Clock;
                      return <Icon className={`size-3 ${selectedTask.status === "processing" ? "animate-spin" : ""}`} />;
                    })()}
                    {selectedTask.status}
                  </span>
                </div>
                {selectedTask.description && (
                  <div>
                    <span className="text-muted-foreground">Description:</span>
                    <p className="mt-1 whitespace-pre-wrap">{selectedTask.description}</p>
                  </div>
                )}
                {selectedTask.result && (
                  <div>
                    <span className="text-muted-foreground">Result:</span>
                    <pre className="mt-1 rounded-lg bg-muted p-3 text-xs overflow-auto max-h-48">
                      {JSON.stringify(selectedTask.result, null, 2)}
                    </pre>
                  </div>
                )}
                {selectedTask.error && (
                  <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                    <span className="text-red-600 dark:text-red-400 text-xs font-medium">Error:</span>
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{selectedTask.error}</p>
                  </div>
                )}
                <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                  Created: {new Date(selectedTask.created_at).toLocaleString()}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tasks List */}
        <div className="lg:col-span-2">
          <div className="panel">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold">Recent Tasks</h2>
              <button
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                onClick={fetchTasks}
              >
                <RefreshCw className="size-4" />
                Refresh
              </button>
            </div>

            {fetching ? (
              <div className="p-8 text-center text-muted-foreground">
                <Loader2 className="size-6 animate-spin mx-auto mb-2" />
                Loading tasks...
              </div>
            ) : tasks.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No tasks yet. Create one to get started.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {tasks.map((task) => {
                  const Icon = statusIcons[task.status] || Clock;
                  return (
                    <button
                      key={task.id}
                      className={`w-full p-4 text-left transition hover:bg-surface-2/50 ${
                        selectedTask?.id === task.id ? "bg-surface-2/80" : ""
                      }`}
                      onClick={() => fetchTaskStatus(task.id)}
                    >
                      <div className="flex items-start gap-3">
                        <Icon className={`size-5 mt-0.5 shrink-0 ${task.status === "processing" ? "animate-spin text-yellow-500" : ""}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{task.title}</p>
                            <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[task.status] || ""}`}>
                              {task.status}
                            </span>
                          </div>
                          {task.description && (
                            <p className="mt-1 text-sm text-muted-foreground truncate">{task.description}</p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(task.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
