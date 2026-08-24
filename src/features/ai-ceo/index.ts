/**
 * AI-CEO Feature
 * Autonomous Chief Architect for Orbit CRM
 */

// Types
export type {
  CommandPrefix,
  ParsedCommand,
  ActionType,
  ApprovalStatus,
  DeploymentStatus,
  RiskLevel,
  TaskClassification,
  Project,
  ProjectBacklog,
  CeoApprovalRequest,
  DeploymentRequest,
  CeoTask,
  CeoAnalysisResult,
  CeoDispatchResult,
  CeoState,
  CeoAgentConfig,
} from "./types";

export {
  CEO_AGENT_CONFIG,
  PROJECT_KEYWORDS,
  RISK_KEYWORDS,
  ACTION_KEYWORDS,
  COMMAND_PATTERNS,
  ROLE_KEYWORDS,
} from "./types";

// Dispatcher
export {
  parseCommand,
  classifyTask,
  assessRisk,
  predictRole,
  dispatchTask,
  routeToProject,
  generateChangePackage,
} from "./dispatcher";

// API
export {
  createApprovalRequest,
  decideApprovalRequest,
  getPendingApprovals,
  getTaskApprovals,
  createDeploymentRequest,
  approveDeployment,
  getPendingDeployments,
  updateCeoTask,
  getCeoTasks,
  getProjects,
  getCeoDashboard,
} from "./api";
