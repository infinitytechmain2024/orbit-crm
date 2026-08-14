export type WorkflowTaskStatus =
  | "planning"
  | "queued"
  | "in_progress"
  | "paused"
  | "review"
  | "approval_required"
  | "done"
  | "blocked"
  | "revisions_requested"
  | "cancelled";

export type WorkflowPriority = "low" | "medium" | "high" | "critical";
export type AgentStatus = "idle" | "assigned" | "working" | "blocked" | "review" | "completed";

export type WorkflowProject = {
  id: string;
  name: string;
  color: string;
  status: string;
};

export type WorkflowDepartment = {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  icon: string;
  created_at: string;
};

export type WorkflowAgent = {
  id: string;
  organization_id: string;
  department_id: string | null;
  name: string;
  role: string;
  description: string;
  status: AgentStatus;
  capabilities: string[];
  default_model: string | null;
  fallback_models: string[];
  system_instruction?: string;
  allowed_tools?: string[];
  access_level?: "read_only" | "internal" | "elevated" | "approval_only";
  is_active: boolean;
  created_at: string;
};

export type WorkflowTask = {
  id: string;
  organization_id: string;
  project_id: string | null;
  department_id: string | null;
  agent_id: string | null;
  parent_task_id: string | null;
  workflow_run_id?: string | null;
  title: string;
  original_request?: string;
  description: string;
  source?: "text" | "voice" | "manual" | "project" | "note" | "client" | "api";
  status: WorkflowTaskStatus;
  priority: WorkflowPriority;
  due_at: string | null;
  input_data: Record<string, unknown>;
  result: Record<string, unknown> | null;
  risk_level?: "low" | "medium" | "high" | "critical";
  approval_required?: boolean;
  goal?: string;
  acceptance_criteria?: unknown[];
  execution_plan?: Record<string, unknown>;
  assumptions?: unknown[];
  blocker_reason?: string | null;
  qa_status?: "pending" | "running" | "passed" | "failed" | "not_required";
  qa_report?: Record<string, unknown> | null;
  attempt_count?: number;
  current_model: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  action_type: "run" | "change" | null;
};

export type WorkflowEvent = {
  id: string;
  organization_id: string;
  task_id: string;
  project_id: string | null;
  agent_id: string | null;
  event_type: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ApprovalRequest = {
  id: string;
  organization_id: string;
  task_id: string;
  requested_by_agent_id: string | null;
  assigned_to_agent_id: string | null;
  status: "pending" | "approved" | "rejected" | "changes_requested" | "cancelled";
  action?: string;
  reason?: string;
  risk?: "low" | "medium" | "high" | "critical";
  executor?: string | null;
  estimated_cost?: number | null;
  currency?: string;
  consequences?: string;
  decision_comment: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type WorkflowArtifact = {
  id: string;
  organization_id: string;
  task_id: string;
  project_id: string | null;
  agent_id: string | null;
  name: string;
  type: string;
  url: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ModelConfig = {
  id: string;
  provider: string;
  model_name: string;
  capabilities: string[];
  priority: number;
  is_enabled: boolean;
  max_retries: number;
};

export type WorkflowRun = {
  id: string;
  organization_id: string;
  workflow_id: string | null;
  root_task_id: string;
  status:
    | "planning"
    | "queued"
    | "running"
    | "paused"
    | "review"
    | "awaiting_approval"
    | "completed"
    | "blocked"
    | "cancelled"
    | "failed";
  commander_state: Record<string, unknown>;
  progress: number;
  current_phase: string;
  created_at: string;
  updated_at: string;
};

export type TaskDependency = {
  organization_id: string;
  task_id: string;
  depends_on_task_id: string;
  dependency_type: "finish_to_start" | "start_to_start" | "related";
  is_required: boolean;
};

export type AgentRun = {
  id: string;
  organization_id: string;
  workflow_run_id: string;
  task_id: string;
  agent_id: string;
  status: "assigned" | "working" | "blocked" | "review" | "completed" | "failed" | "cancelled";
  phase: string;
  attempt: number;
  provider: string | null;
  model: string | null;
  input_snapshot: Record<string, unknown>;
  output_snapshot: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
};

export type WorkflowOverview = {
  departments: WorkflowDepartment[];
  agents: WorkflowAgent[];
  tasks: WorkflowTask[];
  events: WorkflowEvent[];
  artifacts: WorkflowArtifact[];
  approval_requests: ApprovalRequest[];
  projects: WorkflowProject[];
  model_configs: ModelConfig[];
  workflow_runs: WorkflowRun[];
  task_dependencies: TaskDependency[];
  agent_runs: AgentRun[];
  notifications: WorkflowNotification[];
  provider: {
    nvidia_configured: boolean;
    configured?: string[];
    voice_configured: boolean;
    autorun: boolean;
    worker_enabled?: boolean;
  };
};

export type NewWorkflowTask = {
  organization_id: string;
  project_id: string;
  title: string;
  description: string;
  priority: WorkflowPriority;
  due_at: string | null;
  attachments: string[];
  links: string[];
  department_id: string | null;
  agent_id: string | null;
  auto_assign: boolean;
  requires_approval?: boolean;
  source?: "text" | "voice" | "manual" | "project" | "note" | "client" | "api";
  original_request?: string;
  related_entities?: Array<Record<string, string>>;
};
