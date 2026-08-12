import { getSupabaseClient } from "@/lib/supabase/client";
import type { Tables, TablesInsert } from "@/lib/supabase/database.types";
import {
  type GraphLead,
  type GraphObjectType,
  type GraphRelation,
  type GraphRelationType,
  graphNodeId,
} from "@/lib/graph-data";

type GraphRelationRow = Tables<"graph_relations">;
type GraphPositionRow = Tables<"graph_node_positions">;

export type GraphPosition = {
  x: number;
  y: number;
};

function graphError(message: string, errorMessage: string): Error {
  return new Error(`${message}: ${errorMessage}`);
}

function mapRelation(row: GraphRelationRow): GraphRelation {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    targetType: row.target_type,
    targetId: row.target_id,
    relationType: row.relation_type,
    createdAt: row.created_at,
    createdBy: row.created_by,
    implicit: false,
  };
}

export async function fetchGraphLeads(organizationId: string, limit = 250): Promise<GraphLead[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("leads")
    .select("id,company_name,website,status,project_id,responsible_user_id,created_at,source_query")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw graphError("Не удалось загрузить связанных клиентов", error.message);
  return data ?? [];
}

export async function fetchGraphPositions(
  organizationId: string,
  userId: string,
  limit = 2000,
): Promise<Map<string, GraphPosition>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("graph_node_positions")
    .select("node_id,node_type,x_position,y_position")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .limit(limit);

  if (error) throw graphError("Не удалось загрузить расположение графа", error.message);
  return new Map(
    (data ?? []).map((row) => [
      graphNodeId(row.node_type, row.node_id),
      { x: row.x_position, y: row.y_position },
    ]),
  );
}

export async function saveGraphPosition(input: {
  organizationId: string;
  userId: string;
  nodeType: GraphObjectType;
  nodeId: string;
  position: GraphPosition;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const payload: TablesInsert<"graph_node_positions"> = {
    organization_id: input.organizationId,
    user_id: input.userId,
    node_type: input.nodeType,
    node_id: input.nodeId,
    x_position: input.position.x,
    y_position: input.position.y,
  };
  const { error } = await supabase.from("graph_node_positions").upsert(payload, {
    onConflict: "organization_id,user_id,node_type,node_id",
  });
  if (error) throw graphError("Не удалось сохранить положение точки", error.message);
}

export async function fetchProjectGraphRelations(
  organizationId: string,
  limit = 400,
): Promise<GraphRelation[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("graph_relations")
    .select("*")
    .eq("organization_id", organizationId)
    .or("source_type.eq.project,target_type.eq.project")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw graphError("Не удалось загрузить ручные связи проектов", error.message);
  return (data ?? []).map(mapRelation);
}

export async function fetchGraphRelationsForNode(
  organizationId: string,
  nodeType: GraphObjectType,
  nodeId: string,
  limit = 200,
): Promise<GraphRelation[]> {
  const supabase = getSupabaseClient();
  const endpoint = `and(source_type.eq.${nodeType},source_id.eq.${nodeId}),and(target_type.eq.${nodeType},target_id.eq.${nodeId})`;
  const { data, error } = await supabase
    .from("graph_relations")
    .select("*")
    .eq("organization_id", organizationId)
    .or(endpoint)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw graphError("Не удалось раскрыть ручные связи", error.message);
  return (data ?? []).map(mapRelation);
}

export async function createGraphRelation(input: {
  organizationId: string;
  userId: string;
  sourceType: GraphObjectType;
  sourceId: string;
  targetType: GraphObjectType;
  targetId: string;
  relationType: GraphRelationType;
}): Promise<GraphRelation> {
  const supabase = getSupabaseClient();
  const payload: TablesInsert<"graph_relations"> = {
    organization_id: input.organizationId,
    created_by: input.userId,
    source_type: input.sourceType,
    source_id: input.sourceId,
    target_type: input.targetType,
    target_id: input.targetId,
    relation_type: input.relationType,
  };
  const { data, error } = await supabase.from("graph_relations").insert(payload).select().single();

  if (error) throw graphError("Не удалось создать связь", error.message);
  if (!data) throw new Error("Supabase не вернул созданную связь.");
  return mapRelation(data);
}

export function graphPositionRowKey(row: GraphPositionRow): string {
  return graphNodeId(row.node_type, row.node_id);
}
