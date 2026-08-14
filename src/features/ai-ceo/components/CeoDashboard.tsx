/**
 * CEO Dashboard Component
 * Shows overview of CEO operations across all projects
 */

import { useState, useEffect } from "react";
import { getCeoDashboard } from "../api";

interface CeoDashboardProps {
  onRefresh?: () => void;
}

export function CeoDashboard({ onRefresh }: CeoDashboardProps) {
  const [dashboard, setDashboard] = useState<{
    pendingApprovals: number;
    pendingDeployments: number;
    tasksByActionType: Record<string, number>;
    tasksByProject: Record<string, number>;
    recentActivity: Array<{
      id: string;
      action: string;
      timestamp: string;
      details: string;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard();
  }, []);

  async function fetchDashboard() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await getCeoDashboard();

    if (fetchError) {
      setError(fetchError);
    } else {
      setDashboard(data);
    }

    setLoading(false);
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border/50 bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading dashboard...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={fetchDashboard}
          className="mt-2 text-xs text-red-500 underline hover:text-red-600"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!dashboard) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">CEO Overview</h3>
        <button
          onClick={fetchDashboard}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/50 bg-card p-3">
          <div className="text-2xl font-bold text-primary">
            {dashboard.pendingApprovals}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Pending Approvals
          </div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-3">
          <div className="text-2xl font-bold text-amber-500">
            {dashboard.pendingDeployments}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Pending Deployments
          </div>
        </div>
      </div>

      {/* Tasks by Action Type */}
      <div className="rounded-lg border border-border/50 bg-card p-3">
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">
          Tasks by Action Type
        </h4>
        <div className="space-y-1">
          {Object.entries(dashboard.tasksByActionType).map(([type, count]) => (
            <div key={type} className="flex items-center justify-between text-xs">
              <span className="capitalize">{type || "unclassified"}</span>
              <span className="font-medium">{count}</span>
            </div>
          ))}
          {Object.keys(dashboard.tasksByActionType).length === 0 && (
            <p className="text-xs text-muted-foreground">No tasks yet</p>
          )}
        </div>
      </div>

      {/* Tasks by Project */}
      <div className="rounded-lg border border-border/50 bg-card p-3">
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">
          Tasks by Project
        </h4>
        <div className="space-y-1">
          {Object.entries(dashboard.tasksByProject).map(([project, count]) => (
            <div key={project} className="flex items-center justify-between text-xs">
              <span>{project}</span>
              <span className="font-medium">{count}</span>
            </div>
          ))}
          {Object.keys(dashboard.tasksByProject).length === 0 && (
            <p className="text-xs text-muted-foreground">No projects yet</p>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-lg border border-border/50 bg-card p-3">
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">
          Recent Activity
        </h4>
        <div className="space-y-2">
          {dashboard.recentActivity.slice(0, 5).map((activity) => (
            <div key={activity.id} className="text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium">{activity.action}</span>
                <span className="text-muted-foreground">
                  {new Date(activity.timestamp).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {activity.details && (
                <p className="mt-0.5 text-muted-foreground line-clamp-1">
                  {activity.details}
                </p>
              )}
            </div>
          ))}
          {dashboard.recentActivity.length === 0 && (
            <p className="text-xs text-muted-foreground">No recent activity</p>
          )}
        </div>
      </div>
    </div>
  );
}