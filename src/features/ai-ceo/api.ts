/**
 * AI-CEO API Layer
 * Handles communication with Supabase for CEO operations
 */

import { supabase } from "@/lib/supabase/client";
import type {
  CeoApprovalRequest,
  DeploymentRequest,
  CeoTask,
  RiskLevel,
  ActionType,
} from "./types";

// Type for Supabase client
type SupabaseClient = typeof supabase;

// Helper to get supabase client with null check
function getSupabase(): NonNullable<SupabaseClient> {
  if (!supabase) {
    throw new Error("Supabase client not initialized");
  }
  return supabase;
}

// ============================================================
// Approval Requests API
// ============================================================

/**
 * Create a new CEO approval request
 */
export async function createApprovalRequest(params: {
  taskId: string;
  action: string;
  reason?: string;
  riskLevel: RiskLevel;
  changeSummary?: Record<string, unknown>;
}): Promise<{ data: CeoApprovalRequest | null; error: string | null }> {
  const { taskId, action, reason, riskLevel, changeSummary } = params;
  const client = getSupabase();

  // Call the RPC function (using type assertion since types are not generated)
  const { data, error } = await client.rpc("request_ceo_approval" as any, {
    p_task_id: taskId,
    p_action: action,
    p_reason: reason || null,
    p_risk_level: riskLevel,
    p_change_summary: changeSummary || null,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  // Fetch the created approval request
  const { data: approval, error: fetchError } = await client
    .from("ceo_approval_requests" as any)
    .select("*")
    .eq("id", data as string)
    .single();

  if (fetchError) {
    return { data: null, error: fetchError.message };
  }

  return { data: approval as unknown as CeoApprovalRequest, error: null };
}

/**
 * Decide on a CEO approval request
 */
export async function decideApprovalRequest(params: {
  approvalId: string;
  decision: "approved" | "rejected" | "changes_requested";
  comment?: string;
}): Promise<{ success: boolean; error: string | null }> {
  const { approvalId, decision, comment } = params;
  const client = getSupabase();

  const { data, error } = await client.rpc("decide_ceo_approval" as any, {
    p_approval_id: approvalId,
    p_decision: decision,
    p_comment: comment || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: data as boolean, error: null };
}

/**
 * Get all pending approval requests
 */
export async function getPendingApprovals(): Promise<{
  data: CeoApprovalRequest[];
  error: string | null;
}> {
  const client = getSupabase();

  const { data, error } = await client
    .from("ceo_approval_requests" as any)
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data as unknown as CeoApprovalRequest[]) || [], error: null };
}

/**
 * Get approval requests for a specific task
 */
export async function getTaskApprovals(
  taskId: string,
): Promise<{ data: CeoApprovalRequest[]; error: string | null }> {
  const client = getSupabase();

  const { data, error } = await client
    .from("ceo_approval_requests" as any)
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data as unknown as CeoApprovalRequest[]) || [], error: null };
}

// ============================================================
// Deployment Queue API
// ============================================================

/**
 * Create a deployment request
 */
export async function createDeploymentRequest(params: {
  taskId: string;
  projectId: string;
  deploymentType: "frontend" | "backend" | "database" | "config";
  deploymentConfig: Record<string, unknown>;
}): Promise<{ data: DeploymentRequest | null; error: string | null }> {
  const { taskId, projectId, deploymentType, deploymentConfig } = params;
  const client = getSupabase();

  const { data, error } = await client.rpc("request_deployment" as any, {
    p_task_id: taskId,
    p_project_id: projectId,
    p_deployment_type: deploymentType,
    p_deployment_config: deploymentConfig,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  // Fetch the created deployment request
  const { data: deployment, error: fetchError } = await client
    .from("deployment_queue" as any)
    .select("*")
    .eq("id", data as string)
    .single();

  if (fetchError) {
    return { data: null, error: fetchError.message };
  }

  return { data: deployment as unknown as DeploymentRequest, error: null };
}

/**
 * Approve or reject a deployment
 */
export async function approveDeployment(params: {
  deploymentId: string;
  approved: boolean;
}): Promise<{ success: boolean; error: string | null }> {
  const { deploymentId, approved } = params;
  const client = getSupabase();

  const { data, error } = await client.rpc("approve_deployment" as any, {
    p_deployment_id: deploymentId,
    p_approved: approved,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: data as boolean, error: null };
}

/**
 * Get pending deployments
 */
export async function getPendingDeployments(): Promise<{
  data: DeploymentRequest[];
  error: string | null;
}> {
  const client = getSupabase();

  const { data, error } = await client
    .from("deployment_queue" as any)
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data as unknown as DeploymentRequest[]) || [], error: null };
}

// ============================================================
// Task API (CEO-specific)
// ============================================================

/**
 * Update task with CEO-specific fields
 */
export async function updateCeoTask(
  taskId: string,
  updates: {
    action_type?: ActionType;
    approval_status?: string;
    deployment_status?: string;
    risk_assessment?: Record<string, unknown>;
    change_package?: Record<string, unknown>;
  },
): Promise<{ success: boolean; error: string | null }> {
  const client = getSupabase();

  // Use type assertion since the columns were added via migration
  const { error } = await client
    .from("tasks")
    .update(updates as any)
    .eq("id", taskId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, error: null };
}

/**
 * Get tasks with CEO-specific filters
 */
export async function getCeoTasks(filters?: {
  actionType?: ActionType;
  approvalStatus?: string;
  deploymentStatus?: string;
  projectId?: string;
}): Promise<{ data: CeoTask[]; error: string | null }> {
  const client = getSupabase();

  // Use raw query since the columns are added via migration but not in types
  let query = client.from("tasks").select("*" as any);

  if (filters?.actionType) {
    query = query.eq("action_type" as any, filters.actionType);
  }

  if (filters?.approvalStatus) {
    query = query.eq("approval_status" as any, filters.approvalStatus);
  }

  if (filters?.deploymentStatus) {
    query = query.eq("deployment_status" as any, filters.deploymentStatus);
  }

  if (filters?.projectId) {
    query = query.eq("project_id", filters.projectId);
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data as unknown as CeoTask[]) || [], error: null };
}

// ============================================================
// Project API
// ============================================================

/**
 * Get all projects
 */
export async function getProjects(): Promise<{
  data: Array<{ id: string; name: string; color: string; status: string }>;
  error: string | null;
}> {
  const client = getSupabase();

  const { data, error } = await client
    .from("projects")
    .select("id, name, color, status")
    .order("name");

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: data || [], error: null };
}

// ============================================================
// CEO Dashboard API
// ============================================================

/**
 * Get CEO dashboard overview
 */
export async function getCeoDashboard(): Promise<{
  data: {
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
  };
  error: string | null;
}> {
  const client = getSupabase();

  // Get pending approvals count
  const { count: pendingApprovals } = await client
    .from("ceo_approval_requests" as any)
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  // Get pending deployments count
  const { count: pendingDeployments } = await client
    .from("deployment_queue" as any)
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  // Get tasks by action type
  const { data: tasksByAction } = await client
    .from("tasks")
    .select("action_type" as any)
    .not("action_type" as any, "is", null);

  const tasksByActionType: Record<string, number> = {};
  (tasksByAction || []).forEach((task: any) => {
    const type = task.action_type || "unknown";
    tasksByActionType[type] = (tasksByActionType[type] || 0) + 1;
  });

  // Get tasks by project
  const { data: tasksByProject } = await client
    .from("tasks")
    .select("project_id, projects(name)")
    .not("project_id", "is", null);

  const tasksByProjectMap: Record<string, number> = {};
  (tasksByProject || []).forEach((task: any) => {
    const projectName = task.projects?.name || "Unknown";
    tasksByProjectMap[projectName] = (tasksByProjectMap[projectName] || 0) + 1;
  });

  // Get recent activity
  const { data: recentActivity } = await client
    .from("activity_log" as any)
    .select("id, action, entity_type, entity_id, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return {
    data: {
      pendingApprovals: pendingApprovals || 0,
      pendingDeployments: pendingDeployments || 0,
      tasksByActionType,
      tasksByProject: tasksByProjectMap,
      recentActivity: (recentActivity || []).map((a: any) => ({
        id: a.id,
        action: a.action,
        timestamp: a.created_at,
        details: a.entity_type ? `${a.entity_type}: ${a.entity_id || ""}` : "",
      })),
    },
    error: null,
  };
}
