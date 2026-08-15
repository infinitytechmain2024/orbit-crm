import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Target,
  Lightbulb,
  FileCode,
} from "lucide-react";

import { AppShell } from "@/components/crm/AppShell";

export const Route = createFileRoute("/self-development")({
  head: () => ({
    meta: [
      { title: "Self-Development — Orbit CRM" },
      { name: "description", content: "AI-powered self-development goals and improvements" },
    ],
  }),
  component: SelfDevelopmentPage,
});

interface Goal {
  id: string;
  label: string;
  description: string;
  status: string;
  progress: { done: number; total: number } | null;
  priority: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  acceptance_criteria: string[];
}

interface Improvement {
  id: string;
  goal_id: string;
  suggestion: string;
  impact: string | null;
  file_path: string | null;
  code_before: string | null;
  code_after: string | null;
  status: string;
  created_at: string;
}

const statusColors: Record<string, string> = {
  active: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
  pending_review: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  applied: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const statusIcons: Record<string, typeof Clock> = {
  active: Target,
  paused: Clock,
  completed: CheckCircle2,
  error: XCircle,
  cancelled: XCircle,
  pending_review: Clock,
  approved: CheckCircle2,
  applied: CheckCircle2,
  rejected: XCircle,
};

function SelfDevelopmentPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [fetching, setFetching] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formLabel, setFormLabel] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCriteria, setFormCriteria] = useState("");
  const [formPriority, setFormPriority] = useState("normal");
  const [loading, setLoading] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchGoals = async () => {
    try {
      const response = await fetch("/api/openclaw/goals/list?limit=20");
      if (response.ok) {
        const data = await response.json();
        setGoals(data.goals || []);
      }
    } catch (error) {
      console.error("Failed to fetch goals:", error);
    } finally {
      setFetching(false);
    }
  };

  const fetchImprovements = async (goalId?: string) => {
    try {
      const url = goalId
        ? `/api/openclaw/goals/improvements/list?goal_id=${goalId}`
        : "/api/openclaw/goals/improvements/list?limit=50";
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setImprovements(data.improvements || []);
      }
    } catch (error) {
      console.error("Failed to fetch improvements:", error);
    }
  };

  const fetchGoalStatus = async (goalId: string) => {
    try {
      const response = await fetch(`/api/openclaw/goals/status/${goalId}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedGoal(data);
        return data.status;
      }
    } catch (error) {
      console.error("Failed to fetch goal status:", error);
    }
    return null;
  };

  useEffect(() => {
    fetchGoals();
    fetchImprovements();
  }, []);

  useEffect(() => {
    if (selectedGoal && ["active"].includes(selectedGoal.status)) {
      pollingRef.current = setInterval(async () => {
        const status = await fetchGoalStatus(selectedGoal.id);
        if (status && !["active"].includes(status)) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          fetchGoals();
          fetchImprovements(selectedGoal.id);
        }
      }, 5000);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [selectedGoal?.id, selectedGoal?.status]);

  const createGoal = async () => {
    if (!formLabel.trim() || !formDescription.trim()) return;

    setLoading(true);
    try {
      const criteria = formCriteria
        .split("\n")
        .map((c) => c.trim())
        .filter(Boolean);

      const response = await fetch("/api/openclaw/goals/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: formLabel,
          description: formDescription,
          acceptance_criteria: criteria,
          priority: formPriority,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setFormLabel("");
        setFormDescription("");
        setFormCriteria("");
        setFormPriority("normal");
        setShowCreateForm(false);
        fetchGoals();
        fetchGoalStatus(data.goal_id);
      }
    } catch (error) {
      console.error("Failed to create goal:", error);
    } finally {
      setLoading(false);
    }
  };

  const approveImprovement = async (improvementId: string) => {
    try {
      await fetch("/api/openclaw/goals/improvements/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ improvement_id: improvementId }),
      });
      fetchImprovements(selectedGoal?.id);
    } catch (error) {
      console.error("Failed to approve improvement:", error);
    }
  };

  const selectGoal = async (goal: Goal) => {
    await fetchGoalStatus(goal.id);
    fetchImprovements(goal.id);
  };

  const progressPercent = (progress: { done: number; total: number } | null) => {
    if (!progress || progress.total === 0) return 0;
    return Math.round((progress.done / progress.total) * 100);
  };

  return (
    <AppShell
      title="Self-Development"
      subtitle="AI-powered code analysis and improvements"
    >
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Goals */}
        <div className="lg:col-span-1 space-y-4">
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Target className="size-5" />
                Goals
              </h2>
              <button
                className="inline-flex items-center gap-1 text-sm text-primary hover:opacity-80"
                onClick={() => setShowCreateForm(!showCreateForm)}
              >
                <Plus className="size-4" />
                New
              </button>
            </div>

            {showCreateForm && (
              <div className="mb-4 p-4 rounded-lg bg-surface-2/50 border border-border space-y-3">
                <input
                  type="text"
                  placeholder="Goal label"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                />
                <textarea
                  placeholder="Description"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 min-h-[80px] resize-y"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
                <textarea
                  placeholder="Acceptance criteria (one per line)"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 min-h-[60px] resize-y"
                  value={formCriteria}
                  onChange={(e) => setFormCriteria(e.target.value)}
                />
                <select
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
                  value={formPriority}
                  onChange={(e) => setFormPriority(e.target.value)}
                >
                  <option value="low">Low Priority</option>
                  <option value="normal">Normal Priority</option>
                  <option value="high">High Priority</option>
                  <option value="critical">Critical</option>
                </select>
                <div className="flex gap-2">
                  <button
                    className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    onClick={createGoal}
                    disabled={loading || !formLabel.trim() || !formDescription.trim()}
                  >
                    {loading ? <Loader2 className="size-4 animate-spin mx-auto" /> : "Create"}
                  </button>
                  <button
                    className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCreateForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {fetching ? (
              <div className="p-4 text-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin mx-auto mb-2" />
                Loading...
              </div>
            ) : goals.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No goals yet. Create one to get started.
              </div>
            ) : (
              <div className="space-y-2">
                {goals.map((goal) => {
                  const Icon = statusIcons[goal.status] || Clock;
                  return (
                    <button
                      key={goal.id}
                      className={`w-full p-3 rounded-lg text-left transition hover:bg-surface-2/50 ${
                        selectedGoal?.id === goal.id ? "bg-surface-2/80 ring-1 ring-primary/30" : ""
                      }`}
                      onClick={() => selectGoal(goal)}
                    >
                      <div className="flex items-start gap-2">
                        <Icon className={`size-4 mt-0.5 shrink-0 ${goal.status === "active" ? "text-blue-500" : ""}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm truncate">{goal.label}</p>
                            <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColors[goal.status] || ""}`}>
                              {goal.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 truncate">{goal.description}</p>
                          {goal.progress && (
                            <div className="mt-2">
                              <div className="w-full bg-muted rounded-full h-1.5">
                                <div
                                  className="bg-primary h-1.5 rounded-full transition-all"
                                  style={{ width: `${progressPercent(goal.progress)}%` }}
                                />
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {goal.progress.done}/{goal.progress.total} ({progressPercent(goal.progress)}%)
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Details + Improvements */}
        <div className="lg:col-span-2 space-y-4">
          {/* Goal Details */}
          {selectedGoal && (
            <div className="panel p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Target className="size-5" />
                  {selectedGoal.label}
                </h2>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[selectedGoal.status] || ""}`}>
                  {selectedGoal.status}
                </span>
              </div>

              <p className="text-sm text-muted-foreground mb-4">{selectedGoal.description}</p>

              {selectedGoal.acceptance_criteria && selectedGoal.acceptance_criteria.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium mb-2">Acceptance Criteria</h3>
                  <ul className="space-y-1">
                    {selectedGoal.acceptance_criteria.map((criteria, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-primary">•</span>
                        {criteria}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedGoal.progress && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Progress</h3>
                  <div className="w-full bg-muted rounded-full h-2.5">
                    <div
                      className="bg-primary h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${progressPercent(selectedGoal.progress)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedGoal.progress.done} of {selectedGoal.progress.total} completed ({progressPercent(selectedGoal.progress)}%)
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Improvements */}
          <div className="panel">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Lightbulb className="size-5" />
                Improvement Suggestions ({improvements.length})
              </h2>
              <button
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => fetchImprovements(selectedGoal?.id)}
              >
                <RefreshCw className="size-4" />
                Refresh
              </button>
            </div>

            {improvements.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No improvement suggestions yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {improvements.map((imp) => {
                  const Icon = statusIcons[imp.status] || Clock;
                  return (
                    <div key={imp.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <Icon className={`size-5 mt-0.5 shrink-0 ${imp.status === "applied" ? "text-green-500" : imp.status === "pending_review" ? "text-yellow-500" : ""}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-sm">{imp.suggestion}</p>
                            <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColors[imp.status] || ""}`}>
                              {imp.status === "pending_review" ? "Pending" : imp.status === "applied" ? "Applied" : imp.status}
                            </span>
                          </div>

                          {imp.impact && (
                            <p className="text-xs text-muted-foreground mb-1">Impact: {imp.impact}</p>
                          )}

                          {imp.file_path && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                              <FileCode className="size-3" />
                              {imp.file_path}
                            </p>
                          )}

                          {imp.code_before && imp.code_after && (
                            <div className="grid grid-cols-2 gap-2 mt-2 mb-2">
                              <div>
                                <p className="text-[10px] font-medium text-red-500 mb-1">Before</p>
                                <pre className="bg-red-50 dark:bg-red-900/20 p-2 rounded text-[10px] overflow-auto max-h-24 font-mono">
                                  {imp.code_before}
                                </pre>
                              </div>
                              <div>
                                <p className="text-[10px] font-medium text-green-500 mb-1">After</p>
                                <pre className="bg-green-50 dark:bg-green-900/20 p-2 rounded text-[10px] overflow-auto max-h-24 font-mono">
                                  {imp.code_after}
                                </pre>
                              </div>
                            </div>
                          )}

                          {imp.status === "pending_review" && (
                            <button
                              className="mt-2 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                              onClick={() => approveImprovement(imp.id)}
                            >
                              <CheckCircle2 className="size-3" />
                              Approve & Apply
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
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
