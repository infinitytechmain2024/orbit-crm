import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Wifi,
  WifiOff,
  Activity,
  Server,
  Cpu,
  Clock,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

import { AppShell } from "@/components/crm/AppShell";
import { authenticatedFetch } from "@/lib/api-client";
import { useCrm } from "@/lib/crm-store";

export const Route = createFileRoute("/openclaw-tasks")({
  beforeLoad: () => {
    throw redirect({
      to: "/ai-workflow",
    });
  },
  head: () => ({
    meta: [
      { title: "OpenClaw — Developer — Orbit CRM" },
      { name: "description", content: "OpenClaw gateway diagnostics and monitoring" },
    ],
  }),
  component: OpenClawDiagnosticsPage,
});

interface OpenClawHealth {
  status: string;
  gateway: boolean;
  version: string;
  latency_ms: number;
  error: string | null;
}

interface OpenClawTask {
  id: string;
  title: string;
  description: string;
  status: string;
  result: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const statusColor: Record<string, string> = {
  online: "text-green-500",
  offline: "text-red-500",
  error: "text-yellow-500",
};

function OpenClawDiagnosticsPage() {
  const { organization } = useCrm();
  const [health, setHealth] = useState<OpenClawHealth | null>(null);
  const [tasks, setTasks] = useState<OpenClawTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await authenticatedFetch("/api/openclaw/health");
      if (res.ok) {
        setHealth(await res.json());
      } else {
        setHealth({
          status: "error",
          gateway: false,
          version: "",
          latency_ms: 0,
          error: `HTTP ${res.status}`,
        });
      }
    } catch {
      setHealth({
        status: "offline",
        gateway: false,
        version: "",
        latency_ms: 0,
        error: "Connection refused",
      });
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      if (!organization) return;
      const params = new URLSearchParams({ organization_id: organization.id, limit: "20" });
      const res = await authenticatedFetch(`/api/openclaw/tasks?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch {
      // ignore
    }
  }, [organization]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchHealth(), fetchTasks()]);
    setRefreshing(false);
    setLoading(false);
  }, [fetchHealth, fetchTasks]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <AppShell title="OpenClaw — Developer" subtitle="Gateway diagnostics and monitoring">
      <div className="space-y-6">
        {/* Gateway Status */}
        <div className="panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Server className="size-5" />
              Gateway Status
            </h2>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Connecting...
            </div>
          ) : health ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground mb-1">Status</div>
                <div className="flex items-center gap-2">
                  {health.status === "online" ? (
                    <Wifi className={`size-4 ${statusColor[health.status]}`} />
                  ) : (
                    <WifiOff className={`size-4 ${statusColor[health.status]}`} />
                  )}
                  <span className={`font-medium ${statusColor[health.status]}`}>
                    {health.status === "online"
                      ? "Online"
                      : health.status === "offline"
                        ? "Offline"
                        : "Error"}
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground mb-1">Version</div>
                <div className="font-medium">{health.version || "—"}</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground mb-1">Latency</div>
                <div className="font-medium">
                  {health.latency_ms ? `${health.latency_ms}ms` : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground mb-1">Gateway</div>
                <div className="flex items-center gap-2">
                  {health.gateway ? (
                    <Activity className="size-4 text-green-500" />
                  ) : (
                    <AlertTriangle className="size-4 text-red-500" />
                  )}
                  <span className="font-medium">
                    {health.gateway ? "Responding" : "No response"}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {health?.error && (
            <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-600 dark:text-red-400">
              {health.error}
            </div>
          )}
        </div>

        {/* Recent Tasks */}
        <div className="panel">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Cpu className="size-5" />
              Recent Runs
            </h2>
            <span className="text-sm text-muted-foreground">{tasks.length} tasks</span>
          </div>

          {tasks.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No tasks recorded yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {tasks.map((task) => (
                <div key={task.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{task.title}</p>
                      {task.description && (
                        <p className="mt-1 text-sm text-muted-foreground truncate">
                          {task.description}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 ml-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        task.status === "completed"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : task.status === "error"
                            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                            : task.status === "processing"
                              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                              : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                      }`}
                    >
                      {task.status}
                    </span>
                  </div>
                  {task.result && (
                    <pre className="mt-2 rounded-lg bg-muted p-3 text-xs overflow-auto max-h-32">
                      {JSON.stringify(task.result, null, 2)}
                    </pre>
                  )}
                  {task.error && (
                    <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-2 text-xs text-red-600 dark:text-red-400">
                      {task.error}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    {new Date(task.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="panel p-4">
          <p className="text-sm text-muted-foreground">
            This page shows OpenClaw gateway diagnostics. For task management, use{" "}
            <a href="/ai-workflow" className="text-primary hover:underline">
              AI Workflow
            </a>
            .
          </p>
        </div>
      </div>
    </AppShell>
  );
}
