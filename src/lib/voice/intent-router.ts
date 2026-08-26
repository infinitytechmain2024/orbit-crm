import { getSupabaseClient } from "@/lib/supabase/client";
import type { VoiceIntent } from "./processor";

export interface IntentExecutionResult {
  success: boolean;
  action: string;
  result?: Record<string, unknown>;
  error?: string;
}

export async function executeIntent(
  userId: string,
  intent: VoiceIntent,
): Promise<IntentExecutionResult> {
  const supabase = getSupabaseClient();

  switch (intent.type) {
    case "CREATE_TASK":
      return await executeCreateTask(supabase, userId, intent);
    case "ESTIMATE_PROJECT":
      return await executeEstimateProject(supabase, userId, intent);
    case "WEB_SEARCH_LEADS":
      return await executeWebSearchLeads(supabase, userId, intent);
    default:
      return {
        success: false,
        action: "UNKNOWN",
        error: "Неизвестное намерение",
      };
  }
}

async function executeCreateTask(
  supabase: ReturnType<typeof getSupabaseClient>,
  userId: string,
  intent: VoiceIntent,
): Promise<IntentExecutionResult> {
  const { taskTitle, projectName } = intent.entities;

  if (!taskTitle) {
    return {
      success: false,
      action: "CREATE_TASK",
      error: "Не указано название задачи",
    };
  }

  let projectId: string | null = null;

  if (projectName) {
    // Try to find project by name (fuzzy search)
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name")
      .ilike("name", `%${projectName}%`)
      .limit(5);

    if (projects && projects.length > 0) {
      // Use the first match or the one with highest similarity
      projectId = projects[0].id;
    }
  }

  // Create the task
  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      title: taskTitle,
      description: `Создано через голосовую команду: ${intent.rawText}`,
      status: "todo",
      priority: "high",
      project_id: projectId,
      created_by: userId,
      assigned_user_id: userId,
    })
    .select()
    .single();

  if (error) {
    return {
      success: false,
      action: "CREATE_TASK",
      error: error.message,
    };
  }

  return {
    success: true,
    action: "CREATE_TASK",
    result: {
      taskId: task.id,
      taskTitle: task.title,
      projectId,
      projectName: projectName || null,
    },
  };
}

async function executeEstimateProject(
  supabase: ReturnType<typeof getSupabaseClient>,
  userId: string,
  intent: VoiceIntent,
): Promise<IntentExecutionResult> {
  const { projectDescription } = intent.entities;

  if (!projectDescription) {
    return {
      success: false,
      action: "ESTIMATE_PROJECT",
      error: "Не указано описание проекта для сметы",
    };
  }

  // Create a new project with estimate
  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      name: projectDescription,
      description: `Смета создана через голосовую команду: ${intent.rawText}`,
      status: "active",
      owner_id: userId,
    })
    .select()
    .single();

  if (error) {
    return {
      success: false,
      action: "ESTIMATE_PROJECT",
      error: error.message,
    };
  }

  // Add project member
  await supabase.from("project_members").insert({
    project_id: project.id,
    user_id: userId,
    role: "owner",
  });

  return {
    success: true,
    action: "ESTIMATE_PROJECT",
    result: {
      projectId: project.id,
      projectName: project.name,
      estimate: {
        ratePerHour: 10,
        bufferPercent: 15,
        currency: "EUR",
      },
    },
  };
}

async function executeWebSearchLeads(
  supabase: ReturnType<typeof getSupabaseClient>,
  userId: string,
  intent: VoiceIntent,
): Promise<IntentExecutionResult> {
  const { companyName } = intent.entities;

  if (!companyName) {
    return {
      success: false,
      action: "WEB_SEARCH_LEADS",
      error: "Не указано название компании для поиска",
    };
  }

  // This would integrate with OpenManus or a similar browser automation tool
  // For now, we'll create a lead record to track the search request
  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      company_name: companyName,
      source_query: `Поиск контактов компании: ${companyName}`,
      responsible_user_id: userId,
      status: "new",
    })
    .select()
    .single();

  if (error) {
    return {
      success: false,
      action: "WEB_SEARCH_LEADS",
      error: error.message,
    };
  }

  return {
    success: true,
    action: "WEB_SEARCH_LEADS",
    result: {
      leadId: lead.id,
      companyName,
      status: "search_queued",
    },
  };
}

export async function fuzzyFindProject(
  userId: string,
  projectName: string,
): Promise<{ id: string; name: string } | null> {
  const supabase = getSupabaseClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .ilike("name", `%${projectName}%`)
    .limit(5);

  if (!projects || projects.length === 0) {
    return null;
  }

  // Simple fuzzy matching - return first match
  // In production, you could use pg_trgm or embeddings for better matching
  return projects[0];
}
