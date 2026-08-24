/**
 * AI-CEO Types for Orbit CRM
 * Defines the core types for the autonomous Chief Architect / AI-CEO system
 */

// ============================================================
// Command Types
// ============================================================

export type CommandPrefix =
  "/run:" | "/change:" | "/ask:" | "/check:" | "/deploy:" | "/approve:" | "/reject:" | "/status";

export interface ParsedCommand {
  prefix: CommandPrefix | null;
  rawText: string;
  content: string;
  confidence: number;
}

// ============================================================
// Task Classification
// ============================================================

export type ActionType = "run" | "change" | null;
export type ApprovalStatus =
  "draft" | "pending_approval" | "approved" | "rejected" | "changes_requested";
export type DeploymentStatus = "not_deployed" | "pending_deploy" | "deployed" | "deploy_failed";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface TaskClassification {
  actionType: ActionType;
  projectGuess: string | null;
  confidence: number;
  reasoning: string;
}

// ============================================================
// Project Types
// ============================================================

export interface Project {
  id: string;
  name: string;
  color: string;
  status: "planned" | "active" | "paused" | "completed" | "archived";
}

export interface ProjectBacklog {
  id: string;
  project_id: string;
  task_id: string;
  position: number;
  created_at: string;
}

// ============================================================
// Approval Gateway Types
// ============================================================

export interface CeoApprovalRequest {
  id: string;
  task_id: string;
  requested_by_agent: string;
  assigned_to_user: string | null;
  status: "pending" | "approved" | "rejected" | "changes_requested" | "cancelled";
  action: string;
  reason: string | null;
  risk_level: RiskLevel | null;
  change_summary: Record<string, unknown> | null;
  decision_comment: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeploymentRequest {
  id: string;
  task_id: string;
  project_id: string | null;
  deployment_type: "frontend" | "backend" | "database" | "config";
  status: "pending" | "approved" | "deploying" | "deployed" | "failed" | "cancelled";
  deployment_config: Record<string, unknown>;
  approval_required: boolean;
  approved_by: string | null;
  approved_at: string | null;
  deployed_at: string | null;
  deployment_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// CEO Task (extends WorkflowTask)
// ============================================================

export interface CeoTask {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  action_type: ActionType;
  approval_status: ApprovalStatus;
  deployment_status: DeploymentStatus;
  project_id: string | null;
  agent_id: string | null;
  risk_assessment: Record<string, unknown> | null;
  change_package: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// CEO Response Types
// ============================================================

export interface CeoAnalysisResult {
  task: CeoTask;
  classification: TaskClassification;
  approvalRequired: boolean;
  riskLevel: RiskLevel;
  changeSummary: {
    files?: string[];
    sql?: string[];
    configs?: string[];
    description: string;
  };
}

export interface CeoDispatchResult {
  success: boolean;
  action: CommandPrefix;
  taskId: string | null;
  message: string;
  requiresApproval: boolean;
  approvalId?: string;
}

// ============================================================
// CEO State Management
// ============================================================

export interface CeoState {
  currentProject: string | null;
  pendingApprovals: CeoApprovalRequest[];
  recentTasks: CeoTask[];
  deploymentQueue: DeploymentRequest[];
}

// ============================================================
// CEO Agent Configuration
// ============================================================

export interface CeoAgentConfig {
  id: string;
  name: string;
  role: "ceo" | "architect";
  models: {
    primary: string;
    fallback: string[];
  };
  capabilities: string[];
  systemPrompt: string;
}

// Default CEO Agent Configuration
export const CEO_AGENT_CONFIG: CeoAgentConfig = {
  id: "agent-ceo-0000-0000-0000-000000000001",
  name: "Orbit Commander",
  role: "ceo",
  models: {
    primary: "nvidia/llama-3.3-70b-instruct",
    fallback: ["nvidia/gemma-4-31b-it", "openai/gpt-4o"],
  },
  capabilities: [
    "portfolio_management",
    "multi_project_routing",
    "approval_gates",
    "architecture_design",
    "resource_allocation",
  ],
  systemPrompt: `You are the AI CEO (Chief Architect) of Orbit company. Your responsibilities:
1. Receive raw task ideas from the user
2. Analyze which project the task belongs to (Orbit CRM, OSNOVA, BERRDO, or new project)
3. Design architecture: DB structure, folder structure, Vercel/Render configs
4. Classify tasks as /run (operational) or /change (development/backlog)
5. Create draft changes (code, SQL migrations, configs) in pending_approval status
6. NEVER push/deploy/SQL write without explicit human approval
7. Always present changes for Human-in-the-loop approval before destructive actions

When you receive a message, parse the prefix:
- /run: Execute operational tasks (launch agents, process voice, run workflows)
- /change: Development tasks (add features, fix bugs, refactor)
- /ask: Questions and clarifications
- /check: Code review, linting, type checking
- /deploy: Deployment requests

For each task, determine:
- Which project it belongs to
- What changes are needed (files, SQL, configs)
- Risk level and approval requirements
- Present a clear summary for human approval`,
};

// ============================================================
// Project Keywords for Classification
// ============================================================

export const PROJECT_KEYWORDS: Record<string, string[]> = {
  "Orbit CRM": [
    "crm",
    "клиент",
    "клиенты",
    "лид",
    "лиды",
    "продаж",
    "продажи",
    "встреча",
    "встречи",
    "задач",
    "задачи",
    "проект",
    "проекты",
    "дом",
    "комната",
    "жильцы",
    "бронирование",
    "оплат",
    "оплаты",
    "отчет",
    "отчеты",
    "ai workflow",
    "workflow",
    "агент",
    "агенты",
  ],
  OSNOVA: ["osnova", "основа", "базовый", "фундамент", "ядро", "core", "platform", "платформа"],
  BERRDO: ["berrdo", "бердо", "птица", "bird", "aviary", "вольер"],
};

// ============================================================
// Risk Assessment Keywords
// ============================================================

export const RISK_KEYWORDS: Record<RiskLevel, string[]> = {
  critical: [
    "production",
    "продакшн",
    "deploy",
    "деплой",
    "delete",
    "удалить",
    "drop",
    "truncate",
    "payment",
    "оплат",
    "billing",
    "billing",
    "security",
    "безопасность",
    "auth",
    "авторизац",
  ],
  high: [
    "database",
    "база данных",
    "migration",
    "миграц",
    "schema",
    "схема",
    "rls",
    "policy",
    "политик",
    "backup",
    "бэкап",
  ],
  medium: [
    "api",
    "endpoint",
    "endpoint",
    "backend",
    "бэкенд",
    "server",
    "сервер",
    "frontend",
    "фронтенд",
    "ui",
    "ux",
    "component",
    "компонент",
  ],
  low: [
    "docs",
    "документац",
    "readme",
    "comment",
    "комментар",
    "typo",
    "опечатк",
    "style",
    "стиль",
    "format",
    "формат",
  ],
};

// ============================================================
// Action Keywords for Classification
// ============================================================

export const ACTION_KEYWORDS: Record<string, string[]> = {
  run: [
    "запуск",
    "выполнение",
    "старт",
    "execute",
    "run",
    "обработка",
    "стартовать",
    "process",
    "обработать",
    "запустить",
    "start",
    "launch",
    "запусти",
    "выполни",
    "сделай",
    "make",
    "do",
    "выполни",
    "execute",
  ],
  change: [
    "создание",
    "создай",
    "создать",
    "новый",
    "добавление",
    "добавь",
    "обновление",
    "изменение",
    "апдейт",
    "create",
    "add",
    "update",
    "modify",
    "change",
    "fix",
    "исправь",
    "почини",
    "улучши",
    "improve",
    "оптимизируй",
    "optimize",
    "рефактор",
    "refactor",
    "добавь",
    "add",
  ],
  null: [],
};

// ============================================================
// Command Parsing Patterns
// ============================================================

export const COMMAND_PATTERNS: Array<[RegExp, CommandPrefix]> = [
  [/^\/run:\s*/i, "/run:"],
  [/^\/change:\s*/i, "/change:"],
  [/^\/ask:\s*/i, "/ask:"],
  [/^\/check:\s*/i, "/check:"],
  [/^\/deploy:\s*/i, "/deploy:"],
  [/^\/approve:\s*/i, "/approve:"],
  [/^\/reject:\s*/i, "/reject:"],
  [/^\/status\s*/i, "/status"],
];

// ============================================================
// Role Classification Keywords
// ============================================================

export const ROLE_KEYWORDS: Record<string, RegExp[]> = {
  "AI Integrations": [/(ai |ии |модел|nvidia|prompt|промпт|llm|агент)/i],
  "QA / DevOps": [/(тест|qa|ci\/cd|деплой|deploy|ошиб|devops)/i],
  Backend: [/(api|backend|бэкенд|сервер|database|баз|sql|auth|rls)/i],
  Frontend: [/(ui|ux|интерфейс|компонент|css|tailwind|react|tsx|button|form)/i],
  CMO: [/(маркетинг|реклам|lead|лид|конверс|воронк|стратег|позиционир|рост|бренд)/i],
  "Sales Rep": [/(продаж|сделк|клиент|встреч|звонк|предлож)/i],
  SEO: [/(seo|семантик|мета|тег|keyword|ключев|посадочн)/i],
  SMM: [/(smm|соцсет|пост|публикац|instagram|facebook|telegram)/i],
  Рассылка: [/(рассыл|email|письм|newsletter|сегмент)/i],
  Парсинг: [/(парс|скрейп|collect|сбор|данных|api)/i],
  "Data Analyst": [/(аналитик|отчет|kpi|метрик|график|дашборд)/i],
  Рекрутинг: [/(рекрут|ваканс|кандидат|собеседован|найм)/i],
  Онбординг: [/(онбординг|адаптац|новый сотрудник|введение)/i],
  "People Ops": [/(people|команд|процесс|вовлечённость|культура)/i],
  COO: [/(операцион|координац|регламент|процесс команды)/i],
};
