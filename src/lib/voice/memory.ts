import { getSupabaseClient } from "@/lib/supabase/client";

export interface AiMemoryEntry {
  id: string;
  user_id: string;
  entity_type: "project" | "task" | "contact" | "synonym" | "preference";
  key_phrase: string;
  memory_value: Record<string, unknown>;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface CreateMemoryInput {
  entity_type: "project" | "task" | "contact" | "synonym" | "preference";
  key_phrase: string;
  memory_value: Record<string, unknown>;
  confidence?: number;
}

export interface SearchMemoryInput {
  entity_type?: "project" | "task" | "contact" | "synonym" | "preference";
  key_phrase?: string;
  limit?: number;
}

const MEMORY_TABLE = "ai_user_memory";

export async function saveMemory(
  userId: string,
  input: CreateMemoryInput,
): Promise<AiMemoryEntry | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from(MEMORY_TABLE)
    .upsert(
      {
        user_id: userId,
        entity_type: input.entity_type,
        key_phrase: input.key_phrase.toLowerCase().trim(),
        memory_value: input.memory_value,
        confidence: input.confidence ?? 0.8,
      },
      {
        onConflict: "user_id,entity_type,key_phrase",
        ignoreDuplicates: false,
      },
    )
    .select()
    .single();

  if (error) {
    console.error("Failed to save memory:", error);
    return null;
  }

  return data;
}

export async function searchMemory(
  userId: string,
  input: SearchMemoryInput,
): Promise<AiMemoryEntry[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from(MEMORY_TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("confidence", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(input.limit ?? 10);

  if (input.entity_type) {
    query = query.eq("entity_type", input.entity_type);
  }

  if (input.key_phrase) {
    query = query.ilike("key_phrase", `%${input.key_phrase.toLowerCase().trim()}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to search memory:", error);
    return [];
  }

  return data ?? [];
}

export async function getMemoryForIntent(
  userId: string,
  transcript: string,
): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from(MEMORY_TABLE)
    .select("key_phrase, memory_value, entity_type")
    .eq("user_id", userId)
    .gt("confidence", 0.6);

  if (error) {
    console.error("Failed to get memory for intent:", error);
    return {};
  }

  const memories = data ?? [];
  const context: Record<string, unknown> = {};

  for (const memory of memories) {
    if (transcript.toLowerCase().includes(memory.key_phrase)) {
      context[memory.key_phrase] = memory.memory_value;
    }
  }

  return context;
}

export async function learnFromCorrection(
  userId: string,
  originalPhrase: string,
  correctedValue: Record<string, unknown>,
  entityType: "project" | "task" | "contact" | "synonym" | "preference" = "synonym",
): Promise<void> {
  await saveMemory(userId, {
    entity_type: entityType,
    key_phrase: originalPhrase.toLowerCase().trim(),
    memory_value: correctedValue,
    confidence: 0.9,
  });
}

export async function getProjectMemory(
  userId: string,
  projectName: string,
): Promise<string | null> {
  const memories = await searchMemory(userId, {
    entity_type: "project",
    key_phrase: projectName,
    limit: 1,
  });

  if (memories.length > 0) {
    return memories[0].memory_value.project_id as string;
  }

  return null;
}

export async function saveProjectMapping(
  userId: string,
  projectName: string,
  projectId: string,
): Promise<void> {
  await saveMemory(userId, {
    entity_type: "project",
    key_phrase: projectName.toLowerCase().trim(),
    memory_value: { project_id: projectId, project_name: projectName },
    confidence: 0.95,
  });
}
