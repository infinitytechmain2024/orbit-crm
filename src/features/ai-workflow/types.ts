export type WorkflowTaskStatus =
  | "queued"
  | "in_progress"
  | "approval_required"
  | "done"
  | "blocked"
  | "revisions_requested"
  | "cancelled";

export type WorkflowPriority = "low" | "medium" | "high" | "critical";
export type AgentStatus = "working" | "idle" | "blocked";

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
  title: string;
  description: string;
  status: WorkflowTaskStatus;
  priority: WorkflowPriority;
  due_at: string | null;
  input_data: Record<string, unknown>;
  result: Record<string, unknown> | null;
  current_model: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
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
  status: "pending" | "approved" | "rejected";
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

export type WorkflowOverview = {
  departments: WorkflowDepartment[];
  agents: WorkflowAgent[];
  tasks: WorkflowTask[];
  events: WorkflowEvent[];
  artifacts: WorkflowArtifact[];
  approval_requests: ApprovalRequest[];
  projects: WorkflowProject[];
  model_configs: ModelConfig[];
  provider: {
    nvidia_configured: boolean;
    voice_configured: boolean;
    autorun: boolean;
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
};
