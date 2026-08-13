import { getSupabaseClient } from "@/lib/supabase/client";
import type { Json, Tables, TablesInsert } from "@/lib/supabase/database.types";
import {
  GRAPH_OBJECT_LABELS,
  type GraphDirection,
  type GraphEntity,
  type GraphLead,
  type GraphObjectType,
  type GraphRelation,
  type GraphRelationType,
  graphNodeId,
} from "@/lib/graph-data";

type GraphNodeRow = Tables<"graph_nodes">;
type GraphRelationRow = Tables<"graph_relations">;
type GraphPositionRow = Tables<"graph_node_positions">;

export type GraphPosition = { x: number; y: number };

export type GraphNeighborhood = {
  entities: GraphEntity[];
  relations: GraphRelation[];
};

function graphError(message: string, errorMessage: string): Error {
  return new Error(`${message}: ${errorMessage}`);
}

function graphObjectType(value: string): GraphObjectType {
  if (value in GRAPH_OBJECT_LABELS) return value as GraphObjectType;
  return "document";
}

function flattenMetadata(value: Json): Record<string, string | number | null | undefined> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" || typeof item === "number" || item === null
        ? item
        : typeof item === "boolean"
          ? String(item)
          : JSON.stringify(item),
    ]),
  );
}

function mapNode(row: GraphNodeRow): GraphEntity {
  return {
    id: row.entity_id,
    graphNodeId: row.id,
    type: graphObjectType(row.entity_type),
    title: row.title,
    subtitle:
      typeof flattenMetadata(row.metadata)["description"] === "string"
        ? String(flattenMetadata(row.metadata)["description"])
        : undefined,
    projectId: row.project_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    status: row.status ?? undefined,
    metadata: flattenMetadata(row.metadata),
    positionX: row.position_x,
    positionY: row.position_y,
    isAutomatic: row.is_automatic,
  };
}

function mapRelation(row: GraphRelationRow): GraphRelation {
  return {
    id: row.id,
    sourceType: graphObjectType(row.source_type),
    sourceId: row.source_id,
    targetType: graphObjectType(row.target_type),
    targetId: row.target_id,
    relationType: row.relation_type as GraphRelationType,
    direction: row.direction === "two_way" ? "two_way" : "one_way",
    strength: row.strength,
    isAutomatic: row.is_automatic,
    createdAt: row.created_at,
    createdBy: row.created_by,
    implicit: false,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, string | number | boolean | null>)
        : {},
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

export async function fetchTopLevelGraphNodes(
  organizationId: string,
  limit = 200,
): Promise<GraphEntity[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("graph_nodes")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("entity_type", "project")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw graphError("Не удалось загрузить проекты графа", error.message);
  return (data ?? []).map(mapNode);
}

export async function searchGraphNodes(input: {
  organizationId: string;
  query: string;
  types?: GraphObjectType[];
  projectIds?: string[];
  limit?: number;
}): Promise<GraphEntity[]> {
  const supabase = getSupabaseClient();
  let request = supabase
    .from("graph_nodes")
    .select("*")
    .eq("organization_id", input.organizationId)
    .ilike("title", `%${input.query.trim()}%`)
    .order("updated_at", { ascending: false })
    .limit(input.limit ?? 12);
  if (input.types?.length) request = request.in("entity_type", input.types);
  if (input.projectIds?.length) request = request.in("project_id", input.projectIds);
  const { data, error } = await request;
  if (error) throw graphError("Не удалось выполнить поиск по графу", error.message);
  return (data ?? []).map(mapNode);
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
      graphNodeId(graphObjectType(row.node_type), row.node_id),
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
  limit = 500,
): Promise<GraphRelation[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("graph_relations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("source_type", "project")
    .eq("target_type", "project")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw graphError("Не удалось загрузить связи проектов", error.message);
  return (data ?? []).map(mapRelation);
}

export async function fetchGraphNeighborhood(
  organizationId: string,
  nodeType: GraphObjectType,
  nodeId: string,
  limit = 250,
): Promise<GraphNeighborhood> {
  const supabase = getSupabaseClient();
  const endpoint = `and(source_type.eq.${nodeType},source_id.eq.${nodeId}),and(target_type.eq.${nodeType},target_id.eq.${nodeId})`;
  const { data: relationRows, error: relationError } = await supabase
    .from("graph_relations")
    .select("*")
    .eq("organization_id", organizationId)
    .or(endpoint)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (relationError) throw graphError("Не удалось раскрыть связи", relationError.message);
  const graphNodeIds = [
    ...new Set((relationRows ?? []).flatMap((row) => [row.source_node_id, row.target_node_id])),
  ];
  if (!graphNodeIds.length) return { entities: [], relations: [] };
  const { data: nodeRows, error: nodeError } = await supabase
    .from("graph_nodes")
    .select("*")
    .eq("organization_id", organizationId)
    .in("id", graphNodeIds)
    .limit(Math.min(graphNodeIds.length, limit * 2));
  if (nodeError) throw graphError("Не удалось загрузить связанные объекты", nodeError.message);
  return {
    entities: (nodeRows ?? []).map(mapNode),
    relations: (relationRows ?? []).map(mapRelation),
  };
}

export async function fetchGraphRelationsForNode(
  organizationId: string,
  nodeType: GraphObjectType,
  nodeId: string,
  limit = 250,
): Promise<GraphRelation[]> {
  return (await fetchGraphNeighborhood(organizationId, nodeType, nodeId, limit)).relations;
}

async function resolveGraphNodeId(
  organizationId: string,
  entityType: GraphObjectType,
  entityId: string,
): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("graph_nodes")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .single();
  if (error || !data) {
    throw graphError("Узел не найден", error?.message ?? `${entityType}:${entityId}`);
  }
  return data.id;
}

export async function createGraphNode(input: {
  organizationId: string;
  userId: string;
  entityType: GraphObjectType;
  entityId: string;
  title: string;
  projectId?: string | null;
  metadata?: Record<string, Json>;
}): Promise<GraphEntity> {
  const supabase = getSupabaseClient();
  const payload: TablesInsert<"graph_nodes"> = {
    organization_id: input.organizationId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    title: input.title,
    project_id: input.projectId ?? null,
    metadata: input.metadata ?? {},
    is_automatic: false,
    created_by: input.userId,
  };
  const { data, error } = await supabase.from("graph_nodes").insert(payload).select().single();
  if (error) throw graphError("Не удалось создать узел", error.message);
  return mapNode(data);
}

export async function createGraphRelation(input: {
  organizationId: string;
  userId: string;
  sourceType: GraphObjectType;
  sourceId: string;
  targetType: GraphObjectType;
  targetId: string;
  relationType: GraphRelationType;
  direction: GraphDirection;
}): Promise<GraphRelation> {
  const supabase = getSupabaseClient();
  const [sourceNodeId, targetNodeId] = await Promise.all([
    resolveGraphNodeId(input.organizationId, input.sourceType, input.sourceId),
    resolveGraphNodeId(input.organizationId, input.targetType, input.targetId),
  ]);
  const payload: TablesInsert<"graph_relations"> = {
    organization_id: input.organizationId,
    created_by: input.userId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    source_type: input.sourceType,
    source_id: input.sourceId,
    target_type: input.targetType,
    target_id: input.targetId,
    relation_type: input.relationType,
    direction: input.direction,
    is_automatic: false,
    metadata: {},
  };
  const { data, error } = await supabase.from("graph_relations").insert(payload).select().single();
  if (error) throw graphError("Не удалось создать связь", error.message);
  return mapRelation(data);
}

export async function updateGraphRelation(input: {
  relationId: string;
  relationType: GraphRelationType;
  direction: GraphDirection;
}): Promise<GraphRelation> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("graph_relations")
    .update({ relation_type: input.relationType, direction: input.direction })
    .eq("id", input.relationId)
    .eq("is_automatic", false)
    .select()
    .single();
  if (error) throw graphError("Не удалось изменить связь", error.message);
  return mapRelation(data);
}

export async function deleteGraphRelation(relationId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("graph_relations")
    .delete()
    .eq("id", relationId)
    .eq("is_automatic", false);
  if (error) throw graphError("Не удалось удалить связь", error.message);
}

export function graphPositionRowKey(row: GraphPositionRow): string {
  return graphNodeId(graphObjectType(row.node_type), row.node_id);
}
