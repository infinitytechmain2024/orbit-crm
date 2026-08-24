export type MemoryEntityType = "project" | "task" | "contact" | "synonym" | "preference";

export interface AiMemoryEntry {
  id: string;
  user_id: string;
  entity_type: MemoryEntityType;
  key_phrase: string;
  memory_value: Record<string, unknown>;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface CreateMemoryInput {
  entity_type: MemoryEntityType;
  key_phrase: string;
  memory_value: Record<string, unknown>;
  confidence?: number;
}

export interface SearchMemoryInput {
  entity_type?: MemoryEntityType;
  key_phrase?: string;
  limit?: number;
}
