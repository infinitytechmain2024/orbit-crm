/**
 * Approval Gateway Component
 * Shows pending CEO approvals and allows approve/reject actions
 */

import { useState, useEffect } from "react";
import { getPendingApprovals, decideApprovalRequest } from "../api";
import type { CeoApprovalRequest } from "../types";

interface ApprovalGatewayProps {
  onRefresh?: () => void;
}

export function ApprovalGateway({ onRefresh }: ApprovalGatewayProps) {
  const [approvals, setApprovals] = useState<CeoApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Fetch pending approvals
  useEffect(() => {
    fetchApprovals();
  }, []);

  async function fetchApprovals() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await getPendingApprovals();

    if (fetchError) {
      setError(fetchError);
    } else {
      setApprovals(data);
    }

    setLoading(false);
  }

  // Handle approve/reject
  async function handleDecision(
    approvalId: string,
    decision: "approved" | "rejected" | "changes_requested",
    comment?: string,
  ) {
    setProcessingId(approvalId);

    const { success, error: decisionError } = await decideApprovalRequest({
      approvalId,
      decision,
      ...(comment ? { comment } : {}),
    });

    if (decisionError) {
      setError(decisionError);
    } else if (success) {
      // Remove from list
      setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
      onRefresh?.();
    }

    setProcessingId(null);
  }

  // Get risk level badge color
  function getRiskBadgeColor(riskLevel: string | null) {
    switch (riskLevel) {
      case "critical":
        return "bg-red-500/20 text-red-500 border-red-500/30";
      case "high":
        return "bg-orange-500/20 text-orange-500 border-orange-500/30";
      case "medium":
        return "bg-yellow-500/20 text-yellow-500 border-yellow-500/30";
      case "low":
        return "bg-green-500/20 text-green-500 border-green-500/30";
      default:
        return "bg-gray-500/20 text-gray-500 border-gray-500/30";
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border/50 bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading approvals...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={fetchApprovals}
          className="mt-2 text-xs text-red-500 underline hover:text-red-600"
        >
          Retry
        </button>
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-card p-4">
        <p className="text-sm text-muted-foreground">No pending approvals</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Pending Approvals</h3>
        <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">
          {approvals.length}
        </span>
      </div>

      <div className="space-y-2">
        {approvals.map((approval) => (
          <div key={approval.id} className="rounded-lg border border-border/50 bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{approval.action}</span>
                  {approval.risk_level && (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${getRiskBadgeColor(
                        approval.risk_level,
                      )}`}
                    >
                      {approval.risk_level}
                    </span>
                  )}
                </div>

                {approval.reason && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {approval.reason}
                  </p>
                )}

                <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>Task: {approval.task_id.substring(0, 8)}...</span>
                  <span>•</span>
                  <span>{new Date(approval.created_at).toLocaleDateString("ru-RU")}</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDecision(approval.id, "approved")}
                  disabled={processingId === approval.id}
                  className="rounded bg-green-500/20 px-2 py-1 text-[10px] text-green-500 hover:bg-green-500/30 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDecision(approval.id, "changes_requested")}
                  disabled={processingId === approval.id}
                  className="rounded bg-yellow-500/20 px-2 py-1 text-[10px] text-yellow-500 hover:bg-yellow-500/30 disabled:opacity-50"
                >
                  Changes
                </button>
                <button
                  onClick={() => handleDecision(approval.id, "rejected")}
                  disabled={processingId === approval.id}
                  className="rounded bg-red-500/20 px-2 py-1 text-[10px] text-red-500 hover:bg-red-500/30 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
