/**
 * AI-CEO Dispatcher
 * Parses user commands, classifies tasks, and routes to appropriate project
 */

import {
  type ParsedCommand,
  type TaskClassification,
  type CeoDispatchResult,
  type ActionType,
  type RiskLevel,
  type CommandPrefix,
  COMMAND_PATTERNS,
  PROJECT_KEYWORDS,
  RISK_KEYWORDS,
  ACTION_KEYWORDS,
  ROLE_KEYWORDS,
} from "./types";

// ============================================================
// Command Parser
// ============================================================

/**
 * Parse user input to extract command prefix and content
 */
export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  for (const [pattern, prefix] of COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      const content = trimmed.replace(pattern, "").trim();
      return {
        prefix,
        rawText: input,
        content,
        confidence: 0.95,
      };
    }
  }

  // No prefix found - classify as implicit command
  return {
    prefix: null,
    rawText: input,
    content: trimmed,
    confidence: 0.5,
  };
}

// ============================================================
// Task Classifier
// ============================================================

/**
 * Classify task based on content and context
 */
export function classifyTask(
  content: string,
  explicitPrefix?: CommandPrefix | null,
): TaskClassification {
  const lowerContent = content.toLowerCase();

  // 1. Determine action type
  let actionType: ActionType = null;
  let actionConfidence = 0;

  // Check explicit prefix first
  if (explicitPrefix === "/run:") {
    actionType = "run";
    actionConfidence = 0.95;
  } else if (explicitPrefix === "/change:") {
    actionType = "change";
    actionConfidence = 0.95;
  } else {
    // Infer from keywords
    for (const [type, keywords] of Object.entries(ACTION_KEYWORDS)) {
      if (type === "null") continue;
      for (const keyword of keywords) {
        if (lowerContent.includes(keyword.toLowerCase())) {
          actionType = type as ActionType;
          actionConfidence = 0.7;
          break;
        }
      }
      if (actionType) break;
    }

    // Default to "change" if no match
    if (!actionType) {
      actionType = "change";
      actionConfidence = 0.4;
    }
  }

  // 2. Determine project
  let projectGuess: string | null = null;
  let projectConfidence = 0;

  for (const [project, keywords] of Object.entries(PROJECT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        projectGuess = project;
        projectConfidence = 0.7;
        break;
      }
    }
    if (projectGuess) break;
  }

  // Default to Orbit CRM if no match
  if (!projectGuess) {
    projectGuess = "Orbit CRM";
    projectConfidence = 0.4;
  }

  // 3. Determine role
  let roleGuess = "COO";
  for (const [role, patterns] of Object.entries(ROLE_KEYWORDS)) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        roleGuess = role;
        break;
      }
    }
  }

  // 4. Build reasoning
  const reasoning = `
Classification:
- Action: ${actionType} (confidence: ${actionConfidence})
- Project: ${projectGuess} (confidence: ${projectConfidence})
- Role: ${roleGuess}
- Explicit prefix: ${explicitPrefix || "none"}
- Content preview: ${content.substring(0, 100)}...
  `.trim();

  return {
    actionType,
    projectGuess,
    confidence: Math.max(actionConfidence, projectConfidence),
    reasoning,
  };
}

// ============================================================
// Risk Assessor
// ============================================================

/**
 * Assess risk level based on content
 */
export function assessRisk(content: string): RiskLevel {
  const lowerContent = content.toLowerCase();

  for (const [level, keywords] of Object.entries(RISK_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        return level as RiskLevel;
      }
    }
  }

  return "low";
}

// ============================================================
// Role Predictor
// ============================================================

/**
 * Predict which agent role should handle this task
 */
export function predictRole(content: string): string {
  const lowerContent = content.toLowerCase();

  for (const [role, patterns] of Object.entries(ROLE_KEYWORDS)) {
    for (const pattern of patterns) {
      if (pattern.test(lowerContent)) {
        return role;
      }
    }
  }

  return "COO";
}

// ============================================================
// Main Dispatcher
// ============================================================

/**
 * Main dispatch function - parses command, classifies task, and routes
 */
export function dispatchTask(
  input: string,
  options: {
    currentProject?: string;
    userId?: string;
    allowDestructive?: boolean;
  } = {},
): CeoDispatchResult {
  const { currentProject, userId, allowDestructive = false } = options;

  // 1. Parse command
  const parsed = parseCommand(input);

  // 2. Classify task
  const classification = classifyTask(parsed.content, parsed.prefix);

  // 3. Assess risk
  const riskLevel = assessRisk(parsed.content);

  // 4. Determine if approval is required
  const requiresApproval =
    riskLevel === "critical" ||
    riskLevel === "high" ||
    parsed.prefix === "/deploy:" ||
    parsed.prefix === "/approve:";

  // 5. Check if destructive action is allowed
  if (requiresApproval && !allowDestructive) {
    return {
      success: false,
      action: parsed.prefix || "/change:",
      taskId: null,
      message: `⚠️ This task requires approval (risk: ${riskLevel}). Please use /approve: to confirm.`,
      requiresApproval: true,
    };
  }

  // 6. Generate task ID (in real app, this would be from DB)
  const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // 7. Build response
  const response: CeoDispatchResult = {
    success: true,
    action: parsed.prefix || "/change:",
    taskId,
    message: `✅ Task dispatched successfully.
    
**Classification:**
- Action: ${classification.actionType}
- Project: ${classification.projectGuess}
- Risk: ${riskLevel}
- Requires Approval: ${requiresApproval}

**Task ID:** ${taskId}
**Content:** ${parsed.content.substring(0, 100)}${parsed.content.length > 100 ? "..." : ""}
    `,
    requiresApproval,
  };

  return response;
}

// ============================================================
// Multi-Project Router
// ============================================================

/**
 * Route task to correct project based on content analysis
 */
export function routeToProject(
  content: string,
  availableProjects: Array<{ id: string; name: string }>,
): { projectId: string; projectName: string; confidence: number } | null {
  const classification = classifyTask(content);

  if (classification.projectGuess) {
    const project = availableProjects.find(
      (p) => p.name.toLowerCase() === classification.projectGuess?.toLowerCase(),
    );

    if (project) {
      return {
        projectId: project.id,
        projectName: project.name,
        confidence: classification.confidence,
      };
    }
  }

  // Fallback to first project
  if (availableProjects.length > 0) {
    const firstProject = availableProjects[0];
    if (firstProject) {
      return {
        projectId: firstProject.id,
        projectName: firstProject.name,
        confidence: 0.3,
      };
    }
  }

  return null;
}

// ============================================================
// Change Package Generator
// ============================================================

/**
 * Generate a change package for approval
 */
export function generateChangePackage(
  task: {
    title: string;
    description: string;
    actionType: ActionType;
    projectGuess: string | null;
  },
  riskLevel: RiskLevel,
): {
  files: string[];
  sql: string[];
  configs: string[];
  description: string;
  estimatedTime: string;
  estimatedCost: number;
} {
  const { title, description, actionType, projectGuess } = task;

  // Generate files based on task type
  const files: string[] = [];
  const sql: string[] = [];
  const configs: string[] = [];

  // Analyze content for file suggestions
  const lowerContent = `${title} ${description}`.toLowerCase();

  if (lowerContent.includes("component") || lowerContent.includes("ui")) {
    files.push(`src/components/${title.replace(/\s+/g, "")}.tsx`);
  }

  if (lowerContent.includes("api") || lowerContent.includes("endpoint")) {
    files.push(`src/api/${title.replace(/\s+/g, "")}.ts`);
  }

  if (lowerContent.includes("database") || lowerContent.includes("migration")) {
    sql.push(`-- Migration: ${title}`);
    sql.push(`-- Description: ${description}`);
  }

  if (lowerContent.includes("config") || lowerContent.includes("vercel")) {
    configs.push("vercel.json");
  }

  // Estimate time and cost
  const estimatedTime =
    riskLevel === "critical" ? "2-3 hours" : riskLevel === "high" ? "1-2 hours" : "30-60 minutes";
  const estimatedCost = riskLevel === "critical" ? 50 : riskLevel === "high" ? 25 : 10;

  return {
    files,
    sql,
    configs,
    description: `Change package for: ${title}\n\n${description}`,
    estimatedTime,
    estimatedCost,
  };
}
