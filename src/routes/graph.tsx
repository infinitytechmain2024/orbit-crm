import { createFileRoute } from "@tanstack/react-router";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CheckSquare2,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Filter,
  Folder,
  Image as ImageIcon,
  Info,
  Link2,
  Loader2,
  Lock,
  Maximize2,
  MessageCircle,
  Minus,
  Network,
  PanelRightClose,
  Plus,
  Search,
  Tag,
  Trash2,
  UserRound,
  ExternalLink,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { AppShell } from "@/components/crm/AppShell";
import { fetchWorkflowGraphContext } from "@/features/ai-workflow/api";
import { useAuth } from "@/lib/auth";
import { useCrm } from "@/lib/crm-store";
import {
  GRAPH_OBJECT_LABELS,
  GRAPH_RELATION_LABELS,
  GRAPH_TYPE_COLORS,
  buildGraphModel,
  dedupeRelations,
  graphNodeId,
  relatedNodeId,
  relationTouches,
  type GraphEntity,
  type GraphDirection,
  type GraphLead,
  type GraphModel,
  type GraphObjectType,
  type GraphRelation,
  type GraphRelationType,
} from "@/lib/graph-data";
import {
  createGraphRelation,
  deleteGraphRelation,
  fetchGraphLeads,
  fetchGraphNeighborhood,
  fetchGraphPositions,
  fetchProjectGraphRelations,
  fetchTopLevelGraphNodes,
  saveGraphPosition,
  searchGraphNodes,
  updateGraphRelation,
  type GraphPosition,
} from "@/lib/graph-repository";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/graph")({
  head: () => ({
    meta: [
      { title: "Граф знаний — Orbit CRM" },
      {
        name: "description",
        content: "Карта связей проектов, задач, материалов, клиентов и команды",
      },
    ],
  }),
  component: KnowledgeGraphRoute,
});

type KnowledgeNodeData = {
  entity: GraphEntity;
  selected: boolean;
  direct: boolean;
  dimmed: boolean;
  labelVisible: boolean;
  relationCount: number;
  projectColor: string;
};

type KnowledgeNode = Node<KnowledgeNodeData, "knowledge">;

type FilterGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  types: GraphObjectType[];
};

const FILTER_GROUPS: FilterGroup[] = [
  { id: "projects", label: "Проекты", icon: Folder, types: ["project"] },
  {
    id: "tasks",
    label: "Задачи",
    icon: CheckSquare2,
    types: ["task", "checklist_item", "task_label"],
  },
  { id: "clients", label: "Клиенты", icon: UserRound, types: ["client"] },
  {
    id: "materials",
    label: "Материалы",
    icon: FileText,
    types: [
      "site",
      "area",
      "page",
      "document",
      "note",
      "prompt",
      "generation",
      "image",
      "design",
      "file",
      "comment",
      "email",
      "message",
      "decision",
      "approval",
      "request",
    ],
  },
  { id: "people", label: "Люди", icon: UserRound, types: ["person"] },
  {
    id: "finance",
    label: "Финансы",
    icon: CircleDollarSign,
    types: ["finance", "finance_transaction"],
  },
];

const ALL_FILTER_TYPES = new Set(FILTER_GROUPS.flatMap((group) => group.types));

const NODE_ICON: Partial<Record<GraphObjectType, LucideIcon>> = {
  project: Folder,
  task: CheckSquare2,
  person: UserRound,
  client: UserRound,
  document: FileText,
  file: FileText,
  image: ImageIcon,
  design: ImageIcon,
  comment: MessageCircle,
  finance_transaction: CircleDollarSign,
  finance: CircleDollarSign,
  task_label: Tag,
  checklist_item: CheckSquare2,
};

const MATERIAL_TYPES = new Set<GraphObjectType>([
  "document",
  "file",
  "image",
  "design",
  "comment",
  "prompt",
  "generation",
  "page",
  "site",
]);

const RELATION_TYPES = Object.keys(GRAPH_RELATION_LABELS) as GraphRelationType[];

function KnowledgeGraphRoute() {
  return (
    <AppShell
      title="Граф знаний"
      subtitle="Структура проектов, материалов и связей"
      mainClassName="overflow-hidden p-3 sm:p-4"
      hideAssistant
    >
      <ReactFlowProvider>
        <KnowledgeGraphWorkspace />
      </ReactFlowProvider>
    </AppShell>
  );
}

function KnowledgeNodeView({ data }: NodeProps<KnowledgeNode>) {
  const size =
    data.entity.type === "project"
      ? 34
      : ["area", "site", "person", "client"].includes(data.entity.type)
        ? 19
        : data.entity.type === "task"
          ? 14
          : 11;
  const color =
    data.entity.type === "project" ? data.projectColor : GRAPH_TYPE_COLORS[data.entity.type];

  return (
    <div
      className={cn(
        "group relative flex min-w-[40px] items-center gap-3 transition-[opacity,filter] duration-300",
        data.dimmed && "opacity-20 grayscale-[35%]",
      )}
      title={`${GRAPH_OBJECT_LABELS[data.entity.type]} · ${data.entity.title}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-0 !bg-transparent"
        style={{ left: size / 2, width: 2, height: 2 }}
      />
      <div
        className="relative shrink-0 rounded-full border"
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          borderColor: data.selected
            ? "rgba(255,255,255,.9)"
            : data.entity.type === "project"
              ? `${color}dd`
              : `${data.projectColor}aa`,
          boxShadow: data.selected
            ? `0 0 0 7px ${color}22, 0 0 34px ${color}aa`
            : data.direct
              ? `0 0 18px ${color}77`
              : data.entity.projectId
                ? `0 0 0 3px ${data.projectColor}18, 0 0 10px ${color}45`
                : `0 0 10px ${color}45`,
        }}
      >
        {data.selected ? (
          <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-background bg-white" />
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!border-0 !bg-transparent"
        style={{ left: size / 2, width: 2, height: 2 }}
      />
      <div
        className={cn(
          "pointer-events-none max-w-[190px] whitespace-nowrap transition-opacity duration-150 group-hover:opacity-100",
          data.labelVisible ? "opacity-100" : "opacity-0",
        )}
      >
        <p
          className={cn(
            "truncate text-[12px] font-medium text-[#f5f7fa] drop-shadow-[0_2px_8px_rgba(0,0,0,1)]",
            data.entity.type === "project" && "text-[14px] font-semibold text-white",
          )}
        >
          {data.entity.title}
        </p>
        {data.selected && data.entity.type !== "project" ? (
          <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            {GRAPH_OBJECT_LABELS[data.entity.type]} · {formatConnectionCount(data.relationCount)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const nodeTypes = { knowledge: KnowledgeNodeView };

type KnowledgeEdgeData = { parallelOffset?: number };
type KnowledgeEdge = Edge<KnowledgeEdgeData, "relation">;

function RelationEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
}: EdgeProps<KnowledgeEdge>) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.max(1, Math.hypot(dx, dy));
  const offset = data?.parallelOffset ?? 0;
  const controlX = (sourceX + targetX) / 2 + (-dy / length) * offset;
  const controlY = (sourceY + targetY) / 2 + (dx / length) * offset;
  const path = `M ${sourceX} ${sourceY} Q ${controlX} ${controlY} ${targetX} ${targetY}`;
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}

const edgeTypes = { relation: RelationEdgeView };

function MiniMapNode({
  x,
  y,
  width,
  height,
  color,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}) {
  const diameter = Math.min(width, height);
  const cx = x + width / 2;
  const cy = y + height / 2;
  return <circle cx={cx} cy={cy} r={diameter / 2} fill={color ?? "#456878"} />;
}

function KnowledgeGraphWorkspace() {
  const { fitView: fitGraphView } = useReactFlow<KnowledgeNode, KnowledgeEdge>();
  const { user, session } = useAuth();
  const { organization, members, projects, tasks, txs, isLoading } = useCrm();
  const [leads, setLeads] = useState<GraphLead[]>([]);
  const [manualRelations, setManualRelations] = useState<GraphRelation[]>([]);
  const [persistentEntities, setPersistentEntities] = useState<GraphEntity[]>([]);
  const [workflowEntities, setWorkflowEntities] = useState<GraphEntity[]>([]);
  const [workflowRelations, setWorkflowRelations] = useState<GraphRelation[]>([]);
  const [persistedPositions, setPersistedPositions] = useState<Map<string, GraphPosition>>(
    () => new Map(),
  );
  const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [enabledTypes, setEnabledTypes] = useState<Set<GraphObjectType>>(
    () => new Set(ALL_FILTER_TYPES),
  );
  const [enabledProjectIds, setEnabledProjectIds] = useState<Set<string>>(() => new Set());
  const [depth, setDepth] = useState<1 | 2 | 3>(1);
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState("");
  const [remoteSearchResults, setRemoteSearchResults] = useState<GraphEntity[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null);
  const [softError, setSoftError] = useState<string | null>(null);
  const [linkComposerOpen, setLinkComposerOpen] = useState(false);
  const [linkTargetQuery, setLinkTargetQuery] = useState("");
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<GraphRelationType>("related_to");
  const [linkDirection, setLinkDirection] = useState<GraphDirection>("one_way");
  const [creatingLink, setCreatingLink] = useState(false);
  const [busyRelationId, setBusyRelationId] = useState<string | null>(null);
  const initializedOrganization = useRef<string | null>(null);
  const fetchedManualNodes = useRef(new Set<string>());
  const fittedNodeCount = useRef(0);
  const initializedProjectFilters = useRef(false);

  const model = useMemo(() => {
    const base = buildGraphModel({ projects, tasks, members, txs, leads });
    const entities = new Map(base.entities);
    for (const entity of persistentEntities) {
      const key = graphNodeId(entity.type, entity.id);
      const existing = entities.get(key);
      entities.set(key, {
        ...existing,
        ...entity,
        metadata: { ...existing?.metadata, ...entity.metadata },
      });
    }
    for (const entity of workflowEntities) {
      entities.set(graphNodeId(entity.type, entity.id), entity);
    }
    return { ...base, entities };
  }, [leads, members, persistentEntities, projects, tasks, txs, workflowEntities]);

  const relations = useMemo(
    () => dedupeRelations([...manualRelations, ...workflowRelations, ...model.relations]),
    [manualRelations, model.relations, workflowRelations],
  );

  const selectedEntity = selectedNodeId ? (model.entities.get(selectedNodeId) ?? null) : null;

  useEffect(() => {
    if (!organization || !user || initializedOrganization.current === organization.id) return;
    initializedOrganization.current = organization.id;
    let alive = true;

    Promise.allSettled([
      fetchGraphLeads(organization.id),
      fetchGraphPositions(organization.id, user.id),
      fetchProjectGraphRelations(organization.id),
      fetchTopLevelGraphNodes(organization.id),
    ]).then(([leadResult, positionResult, relationResult, nodeResult]) => {
      if (!alive) return;
      if (leadResult.status === "fulfilled") setLeads(leadResult.value);
      if (positionResult.status === "fulfilled") setPersistedPositions(positionResult.value);
      if (relationResult.status === "fulfilled") setManualRelations(relationResult.value);
      if (nodeResult.status === "fulfilled") setPersistentEntities(nodeResult.value);

      const graphFailure = [positionResult, relationResult, nodeResult].find(
        (result) => result.status === "rejected",
      );
      if (graphFailure?.status === "rejected") {
        setSchemaWarning(
          "Автоматические связи доступны. Примените новую миграцию Supabase, чтобы сохранять расположение и ручные связи.",
        );
      }
      if (leadResult.status === "rejected") setLeads([]);
    });

    return () => {
      alive = false;
    };
  }, [organization, user]);

  useEffect(() => {
    if (!projects.length || initializedProjectFilters.current) return;
    initializedProjectFilters.current = true;
    setEnabledProjectIds(new Set(projects.map((project) => project.id)));
  }, [projects]);

  useEffect(() => {
    if (!organization || !session?.access_token) return;
    let alive = true;
    fetchWorkflowGraphContext(session.access_token, organization.id)
      .then((context) => {
        if (!alive) return;
        const allowedTypes = new Set<GraphObjectType>([
          "project",
          "task",
          "person",
          "document",
          "file",
        ]);
        const entities: GraphEntity[] = context.nodes
          .filter((node) => allowedTypes.has(node.node_type))
          .map((node) => ({
            id: node.id,
            type: node.node_type,
            title: node.title,
            subtitle:
              node.node_type === "person"
                ? String(node.metadata["role"] ?? "AI-агент")
                : node.node_type === "task"
                  ? "AI Workflow"
                  : undefined,
            projectId:
              typeof node.metadata["project_id"] === "string"
                ? node.metadata["project_id"]
                : node.node_type === "project"
                  ? node.id
                  : null,
            status: node.status,
            createdAt: node.created_at,
            metadata: Object.fromEntries(
              Object.entries(node.metadata).map(([key, value]) => [
                key,
                typeof value === "string" || typeof value === "number" || value === null
                  ? value
                  : JSON.stringify(value),
              ]),
            ),
          }));
        const relationTypes = new Set<GraphRelationType>(
          Object.keys(GRAPH_RELATION_LABELS) as GraphRelationType[],
        );
        const edges: GraphRelation[] = context.edges
          .filter(
            (edge) =>
              allowedTypes.has(edge.source_type as GraphObjectType) &&
              allowedTypes.has(edge.target_type as GraphObjectType) &&
              relationTypes.has(edge.relation_type as GraphRelationType),
          )
          .map((edge) => ({
            id: edge.id,
            sourceType: edge.source_type as GraphObjectType,
            sourceId: edge.source_id,
            targetType: edge.target_type as GraphObjectType,
            targetId: edge.target_id,
            relationType: edge.relation_type as GraphRelationType,
            direction: "one_way",
            strength: 1,
            isAutomatic: true,
            createdAt: edge.created_at,
            createdBy: edge.created_by,
            implicit: false,
          }));
        setWorkflowEntities(entities);
        setWorkflowRelations(edges);
      })
      .catch(() => {
        // AI Workflow is an optional enrichment source. The Supabase graph remains
        // fully usable when the orchestration backend is not running locally.
        setWorkflowEntities([]);
        setWorkflowRelations([]);
      });
    return () => {
      alive = false;
    };
  }, [organization, session?.access_token]);

  useEffect(() => {
    if (isLoading || !projects.length || !organization) return;
    if (visibleNodeIds.size || selectedNodeId) return;
    setVisibleNodeIds(new Set(projects.map((project) => graphNodeId("project", project.id))));
  }, [isLoading, organization, projects, selectedNodeId, visibleNodeIds.size]);

  const distances = useMemo(
    () =>
      selectedNodeId ? getGraphDistances(selectedNodeId, relations, 3) : new Map<string, number>(),
    [relations, selectedNodeId],
  );

  const revealNeighborhood = useCallback(
    (rootId: string, requestedDepth: number) => {
      const reachable = getGraphDistances(rootId, relations, requestedDepth);
      setVisibleNodeIds((current) => {
        const next = new Set(current);
        for (const nodeId of reachable.keys()) {
          const entity = model.entities.get(nodeId);
          if (entity && (enabledTypes.has(entity.type) || nodeId === rootId)) next.add(nodeId);
          if (next.size >= 220) break;
        }
        return next;
      });
    },
    [enabledTypes, model.entities, relations],
  );

  useEffect(() => {
    if (!selectedNodeId) return;
    revealNeighborhood(selectedNodeId, depth);
  }, [depth, relations, revealNeighborhood, selectedNodeId]);

  useEffect(() => {
    if (
      !selectedEntity ||
      !organization ||
      !user ||
      fetchedManualNodes.current.has(selectedNodeId!)
    ) {
      return;
    }
    const lookupId = selectedNodeId!;
    fetchedManualNodes.current.add(lookupId);
    fetchGraphNeighborhood(organization.id, selectedEntity.type, selectedEntity.id)
      .then((loaded) => {
        setManualRelations((current) => dedupeRelations([...loaded.relations, ...current]));
        setPersistentEntities((current) => {
          const merged = new Map(
            current.map((entity) => [graphNodeId(entity.type, entity.id), entity]),
          );
          for (const entity of loaded.entities) {
            merged.set(graphNodeId(entity.type, entity.id), entity);
          }
          return [...merged.values()];
        });
      })
      .catch(() => {
        if (!schemaWarning) {
          setSchemaWarning(
            "Ручные связи станут доступны после применения миграции графа в Supabase.",
          );
        }
      });
  }, [organization, schemaWarning, selectedEntity, selectedNodeId, user]);

  const positionedNodes = useMemo(() => {
    const allowedVisible = [...visibleNodeIds].filter((nodeId) => {
      const entity = model.entities.get(nodeId);
      if (!entity || (!enabledTypes.has(entity.type) && nodeId !== selectedNodeId)) return false;
      const projectId = entity.type === "project" ? entity.id : entity.projectId;
      return !projectId || enabledProjectIds.has(projectId) || nodeId === selectedNodeId;
    });
    return allowedVisible
      .map((nodeId) => model.entities.get(nodeId))
      .filter((entity): entity is GraphEntity => Boolean(entity))
      .map((entity) => {
        const id = graphNodeId(entity.type, entity.id);
        const distance = distances.get(id);
        const direct = distance === 1;
        const hasSavedPosition =
          persistedPositions.has(id) ||
          (typeof entity.positionX === "number" && typeof entity.positionY === "number");
        const position =
          !hasSavedPosition && direct && selectedEntity?.type === "project"
            ? connectedEntityPosition(entity, selectedEntity, model)
            : (persistedPositions.get(id) ??
              calculateEntityPosition(entity, model, persistedPositions));
        return {
          id,
          type: "knowledge" as const,
          position,
          data: {
            entity,
            selected: id === selectedNodeId,
            direct,
            dimmed: Boolean(selectedNodeId) && distance === undefined,
            labelVisible:
              entity.type === "project" ||
              id === selectedNodeId ||
              direct ||
              (zoom >= 1.18 && distance !== undefined),
            relationCount: relations.filter((relation) => relationTouches(relation, id)).length,
            projectColor: projectColorForEntity(entity, model),
          },
          draggable: true,
          selectable: true,
          zIndex: id === selectedNodeId ? 20 : direct ? 10 : 1,
        } satisfies KnowledgeNode;
      });
  }, [
    distances,
    enabledProjectIds,
    enabledTypes,
    model,
    persistedPositions,
    relations,
    selectedEntity,
    selectedNodeId,
    visibleNodeIds,
    zoom,
  ]);

  useEffect(() => setNodes(positionedNodes), [positionedNodes]);

  useEffect(() => {
    if (!positionedNodes.length || fittedNodeCount.current === positionedNodes.length) return;
    fittedNodeCount.current = positionedNodes.length;
    const timer = window.setTimeout(() => {
      void fitGraphView({ duration: 280, padding: 0.2, maxZoom: 1.05 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [fitGraphView, positionedNodes.length]);

  const edges = useMemo<KnowledgeEdge[]>(() => {
    const visible = new Set(positionedNodes.map((node) => node.id));
    return relations
      .filter((relation) => {
        const source = graphNodeId(relation.sourceType, relation.sourceId);
        const target = graphNodeId(relation.targetType, relation.targetId);
        if (!visible.has(source) || !visible.has(target)) return false;
        if (!selectedNodeId) return true;
        const sourceDistance = distances.get(source);
        const targetDistance = distances.get(target);
        return (
          sourceDistance !== undefined &&
          targetDistance !== undefined &&
          sourceDistance <= depth &&
          targetDistance <= depth
        );
      })
      .flatMap((relation) => {
        const source = graphNodeId(relation.sourceType, relation.sourceId);
        const target = graphNodeId(relation.targetType, relation.targetId);
        const selectedEdge = selectedNodeId ? relationTouches(relation, selectedNodeId) : false;
        const sourceDistance = distances.get(source);
        const targetDistance = distances.get(target);
        const secondary =
          Boolean(selectedNodeId) &&
          !selectedEdge &&
          sourceDistance !== undefined &&
          targetDistance !== undefined;
        const dimmed =
          Boolean(selectedNodeId) &&
          !selectedEdge &&
          !(sourceDistance !== undefined && targetDistance !== undefined);
        const reused =
          relation.relationType === "used_in" ||
          relation.relationType === "uses" ||
          relation.relationType === "adapted_for" ||
          (relation.relationType === "related_to" && relation.sourceType === "project");
        const clusterColor = edgeColorForRelation(relation, model);
        const stroke = selectedEdge ? clusterColor : secondary ? "#5bcfc4" : "#456878";
        const makeEdge = (
          edgeId: string,
          edgeSource: string,
          edgeTarget: string,
          parallelOffset: number,
        ): KnowledgeEdge => ({
          id: edgeId,
          source: edgeSource,
          target: edgeTarget,
          type: "relation",
          data: { parallelOffset },
          animated: selectedEdge && !relation.isAutomatic,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
            width: selectedEdge ? 12 : 8,
            height: selectedEdge ? 12 : 8,
          },
          style: {
            stroke,
            strokeWidth: selectedEdge ? 1.9 : Math.max(0.85, relation.strength),
            strokeOpacity: dimmed ? 0.1 : selectedEdge ? 0.95 : secondary ? 0.6 : 0.38,
            strokeDasharray: reused ? "4 6" : undefined,
          },
          zIndex: selectedEdge ? 8 : 0,
        });
        if (relation.direction === "two_way") {
          return [
            makeEdge(`${relation.id}:forward`, source, target, 18),
            makeEdge(`${relation.id}:reverse`, target, source, 18),
          ];
        }
        return [makeEdge(relation.id, source, target, selectedEdge ? 8 : 0)];
      });
  }, [depth, distances, model, positionedNodes, relations, selectedNodeId]);

  useEffect(() => {
    if (!organization || search.trim().length < 2) {
      setRemoteSearchResults([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      searchGraphNodes({
        organizationId: organization.id,
        query: search,
        types: [...enabledTypes],
        limit: 12,
      })
        .then((items) => {
          if (alive) setRemoteSearchResults(items);
        })
        .catch(() => {
          if (alive) setRemoteSearchResults([]);
        });
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [enabledProjectIds, enabledTypes, organization, search]);

  const searchResults = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("ru");
    if (!normalized) return [];
    const combined = new Map<string, GraphEntity>();
    for (const entity of [...remoteSearchResults, ...model.entities.values()]) {
      combined.set(graphNodeId(entity.type, entity.id), entity);
    }
    return [...combined.values()]
      .filter((entity) => enabledTypes.has(entity.type))
      .filter((entity) => {
        const projectId = entity.type === "project" ? entity.id : entity.projectId;
        return !projectId || enabledProjectIds.has(projectId);
      })
      .filter((entity) =>
        `${entity.title} ${entity.subtitle ?? ""}`.toLocaleLowerCase("ru").includes(normalized),
      )
      .slice(0, 8);
  }, [enabledProjectIds, enabledTypes, model.entities, remoteSearchResults, search]);

  const linkTargetResults = useMemo(() => {
    if (!selectedNodeId) return [];
    const normalized = linkTargetQuery.trim().toLocaleLowerCase("ru");
    return [...model.entities.values()]
      .filter((entity) => graphNodeId(entity.type, entity.id) !== selectedNodeId)
      .filter((entity) =>
        normalized
          ? `${entity.title} ${GRAPH_OBJECT_LABELS[entity.type]}`
              .toLocaleLowerCase("ru")
              .includes(normalized)
          : entity.type === "project",
      )
      .slice(0, 7);
  }, [linkTargetQuery, model.entities, selectedNodeId]);

  const selectSearchEntity = (entity: GraphEntity) => {
    const id = graphNodeId(entity.type, entity.id);
    setPersistentEntities((current) => {
      const next = new Map(current.map((item) => [graphNodeId(item.type, item.id), item]));
      next.set(id, entity);
      return [...next.values()];
    });
    setVisibleNodeIds((current) => new Set(current).add(id));
    setSelectedNodeId(id);
    setSearch("");
  };

  const toggleFilterGroup = (group: FilterGroup) => {
    setEnabledTypes((current) => {
      const next = new Set(current);
      const groupEnabled = group.types.every((type) => next.has(type));
      for (const type of group.types) {
        if (groupEnabled) next.delete(type);
        else next.add(type);
      }
      return next;
    });
  };

  const handleNodesChange = useCallback((changes: NodeChange<KnowledgeNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const handleNodeDragStop = useCallback(
    (_event: ReactMouseEvent, node: KnowledgeNode) => {
      const entity = node.data.entity;
      setPersistedPositions((current) => {
        const next = new Map(current);
        next.set(node.id, node.position);
        return next;
      });
      if (!organization || !user || schemaWarning) return;
      saveGraphPosition({
        organizationId: organization.id,
        userId: user.id,
        nodeType: entity.type,
        nodeId: entity.id,
        position: node.position,
      }).catch(() => setSoftError("Позиция сохранена только для текущей сессии."));
    },
    [organization, schemaWarning, user],
  );

  const submitLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!organization || !user || !selectedEntity || !linkTargetId) return;
    const target = model.entities.get(linkTargetId);
    if (!target) return;
    const duplicate = relations.some(
      (relation) =>
        relation.sourceType === selectedEntity.type &&
        relation.sourceId === selectedEntity.id &&
        relation.targetType === target.type &&
        relation.targetId === target.id &&
        relation.relationType === linkType &&
        relation.direction === linkDirection,
    );
    if (duplicate) {
      setSoftError("Такая связь уже существует.");
      return;
    }

    setCreatingLink(true);
    setSoftError(null);
    try {
      const relation = await createGraphRelation({
        organizationId: organization.id,
        userId: user.id,
        sourceType: selectedEntity.type,
        sourceId: selectedEntity.id,
        targetType: target.type,
        targetId: target.id,
        relationType: linkType,
        direction: linkDirection,
      });
      setManualRelations((current) => dedupeRelations([...current, relation]));
      setVisibleNodeIds((current) => new Set(current).add(linkTargetId));
      setLinkComposerOpen(false);
      setLinkTargetId(null);
      setLinkTargetQuery("");
      setLinkDirection("one_way");
    } catch (error) {
      setSoftError(error instanceof Error ? error.message : "Не удалось создать связь.");
    } finally {
      setCreatingLink(false);
    }
  };

  const handleUpdateRelation = async (
    relation: GraphRelation,
    relationType: GraphRelationType,
    direction: GraphDirection,
  ) => {
    if (relation.isAutomatic || relation.implicit) return;
    setBusyRelationId(relation.id);
    setSoftError(null);
    try {
      const updated = await updateGraphRelation({
        relationId: relation.id,
        relationType,
        direction,
      });
      setManualRelations((current) =>
        current.map((item) => (item.id === relation.id ? updated : item)),
      );
    } catch (error) {
      setSoftError(error instanceof Error ? error.message : "Не удалось изменить связь.");
    } finally {
      setBusyRelationId(null);
    }
  };

  const handleDeleteRelation = async (relation: GraphRelation) => {
    if (relation.isAutomatic || relation.implicit) return;
    setBusyRelationId(relation.id);
    setSoftError(null);
    try {
      await deleteGraphRelation(relation.id);
      setManualRelations((current) => current.filter((item) => item.id !== relation.id));
    } catch (error) {
      setSoftError(error instanceof Error ? error.message : "Не удалось удалить связь.");
    } finally {
      setBusyRelationId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="grid h-[calc(100vh-8.75rem)] min-h-[560px] place-items-center rounded-2xl border border-border bg-surface/45">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-primary" />
          Собираю реальные связи…
        </div>
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div className="grid h-[calc(100vh-8.75rem)] min-h-[560px] place-items-center rounded-2xl border border-dashed border-border bg-surface/35 px-6 text-center">
        <div className="max-w-sm">
          <Network className="mx-auto size-10 text-primary/70" />
          <h2 className="mt-4 text-base font-semibold">Граф начнётся с первого проекта</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Создайте проект — связанные задачи, материалы и участники появятся здесь автоматически.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-8.75rem)] min-h-[560px] overflow-hidden rounded-2xl border border-border bg-[#071722]/80 shadow-[0_24px_80px_-48px_rgba(0,0,0,.95)]">
      <div
        className={cn(
          "h-full min-w-0 transition-[width]",
          selectedEntity ? "xl:w-[calc(100%-338px)]" : "w-full",
        )}
      >
        <ReactFlow<KnowledgeNode, KnowledgeEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onNodeClick={(_event, node) =>
            setSelectedNodeId((current) => (current === node.id ? null : node.id))
          }
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={() => {
            setFiltersOpen(false);
            setLinkComposerOpen(false);
          }}
          onMove={(_event, viewport) => setZoom(viewport.zoom)}
          fitView
          fitViewOptions={{ padding: 0.22, maxZoom: 1.05 }}
          minZoom={0.22}
          maxZoom={2.2}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          className="knowledge-flow"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={34}
            size={1}
            color="rgba(57, 171, 184, .16)"
          />

          <Panel position="top-left" className="!m-4">
            <div className="hidden items-center gap-2 rounded-xl border border-white/8 bg-[#091923]/76 px-3 py-2 text-[11px] text-slate-300 backdrop-blur-xl 2xl:flex">
              <Info className="size-4 text-slate-300" />
              Выберите точку, чтобы увидеть связи
            </div>
          </Panel>

          <Panel position="top-right" className="!m-4 max-w-[calc(100%-2rem)]">
            <div className="flex flex-wrap justify-end gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Найти объект"
                  className="h-9 w-44 rounded-xl border border-white/10 bg-[#091923]/88 pl-9 pr-8 text-xs text-white outline-none backdrop-blur-xl transition focus:w-56 focus:border-primary/60"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                    aria-label="Очистить поиск"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
                {search ? (
                  <div className="absolute right-0 top-11 z-40 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#0b1b26]/98 p-1.5 shadow-2xl backdrop-blur-xl">
                    {searchResults.length ? (
                      searchResults.map((entity) => {
                        const color = GRAPH_TYPE_COLORS[entity.type];
                        return (
                          <button
                            key={graphNodeId(entity.type, entity.id)}
                            type="button"
                            onClick={() => selectSearchEntity(entity)}
                            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/6"
                          >
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs text-white">
                                {entity.title}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {GRAPH_OBJECT_LABELS[entity.type]}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <p className="px-3 py-4 text-center text-xs text-slate-500">
                        Ничего не найдено
                      </p>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((value) => !value)}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-[#091923]/88 px-3 text-xs text-slate-300 backdrop-blur-xl transition hover:text-white",
                    filtersOpen && "border-primary/50 text-primary",
                  )}
                >
                  <Filter className="size-3.5" />
                  Фильтры
                </button>
                {filtersOpen ? (
                  <div className="absolute right-0 top-11 z-40 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-white/10 bg-[#0b1b26]/98 p-2 shadow-2xl backdrop-blur-xl">
                    {FILTER_GROUPS.map((group) => {
                      const active = group.types.every((type) => enabledTypes.has(type));
                      return (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => toggleFilterGroup(group)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 transition hover:bg-white/6 hover:text-white"
                        >
                          <span
                            className={cn(
                              "grid size-4 place-items-center rounded border border-white/15",
                              active && "border-primary bg-primary text-primary-foreground",
                            )}
                          >
                            {active ? <Check className="size-3" /> : null}
                          </span>
                          <group.icon className="size-3.5 text-slate-500" />
                          {group.label}
                        </button>
                      );
                    })}
                    <div className="my-2 border-t border-white/8" />
                    <div className="flex items-center justify-between px-2.5 py-1">
                      <span className="text-[9px] uppercase tracking-[0.12em] text-slate-600">
                        Проекты
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setEnabledProjectIds(
                            enabledProjectIds.size
                              ? new Set()
                              : new Set(projects.map((item) => item.id)),
                          )
                        }
                        className="text-[9px] text-primary/70 hover:text-primary"
                      >
                        {enabledProjectIds.size ? "Снять все" : "Выбрать все"}
                      </button>
                    </div>
                    {projects.map((project) => {
                      const active = enabledProjectIds.has(project.id);
                      return (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() =>
                            setEnabledProjectIds((current) => {
                              const next = new Set(current);
                              if (next.has(project.id)) next.delete(project.id);
                              else next.add(project.id);
                              return next;
                            })
                          }
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 transition hover:bg-white/6 hover:text-white"
                        >
                          <span
                            className={cn(
                              "grid size-4 place-items-center rounded border border-white/15",
                              active && "border-primary bg-primary text-primary-foreground",
                            )}
                          >
                            {active ? <Check className="size-3" /> : null}
                          </span>
                          <span
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: projectColor(project.name, project.id) }}
                          />
                          <span className="truncate">{project.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="flex h-9 items-center rounded-xl border border-white/10 bg-[#091923]/88 p-1 backdrop-blur-xl">
                {[1, 2, 3].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDepth(value as 1 | 2 | 3)}
                    className={cn(
                      "grid h-7 min-w-7 place-items-center rounded-lg px-2 text-[11px] text-slate-500 transition",
                      depth === value && "bg-primary/14 text-primary",
                    )}
                    title={`${value} уровень связей`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel position="bottom-center" className="!mb-5 hidden sm:block">
            <GraphLegend />
          </Panel>

          <MiniMap
            className="!bottom-4 !left-4 !m-0 !h-[92px] !w-[168px] !rounded-xl !border !border-white/10 !bg-[#091923]/84 backdrop-blur-xl"
            nodeColor={(node) => {
              const knowledgeNode = node as KnowledgeNode;
              return GRAPH_TYPE_COLORS[knowledgeNode.data.entity.type];
            }}
            nodeStrokeWidth={0}
            nodeComponent={MiniMapNode}
            maskColor="rgba(4, 14, 22, .64)"
            pannable
            zoomable
          />

          <GraphZoomControls zoom={zoom} />
        </ReactFlow>
      </div>

      {schemaWarning ? (
        <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-26rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-amber-400/20 bg-[#19170f]/92 px-3 py-2 text-[10px] text-amber-100 shadow-xl backdrop-blur-xl xl:mr-[338px]">
          <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
          {schemaWarning}
          <button type="button" onClick={() => setSchemaWarning(null)} aria-label="Закрыть">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {softError ? (
        <button
          type="button"
          onClick={() => setSoftError(null)}
          className="absolute bottom-4 left-1/2 z-30 max-w-[min(90%,34rem)] -translate-x-1/2 rounded-xl border border-red-400/20 bg-[#201217]/95 px-4 py-2 text-xs text-red-200 shadow-xl"
        >
          {softError}
        </button>
      ) : null}

      {selectedEntity ? (
        <GraphDetailsPanel
          entity={selectedEntity}
          model={model}
          relations={relations}
          selectedNodeId={selectedNodeId!}
          onClose={() => setSelectedNodeId(null)}
          onRevealAll={() => {
            setDepth(3);
            revealNeighborhood(selectedNodeId!, 3);
          }}
          composerOpen={linkComposerOpen}
          onComposerOpenChange={(open) => {
            setLinkComposerOpen(open);
            if (!open) {
              setLinkTargetId(null);
              setLinkTargetQuery("");
              setLinkDirection("one_way");
            }
          }}
          linkTargetQuery={linkTargetQuery}
          onLinkTargetQueryChange={setLinkTargetQuery}
          linkTargetId={linkTargetId}
          onLinkTargetIdChange={setLinkTargetId}
          linkTargetResults={linkTargetResults}
          linkType={linkType}
          onLinkTypeChange={setLinkType}
          linkDirection={linkDirection}
          onLinkDirectionChange={setLinkDirection}
          onSubmitLink={submitLink}
          creatingLink={creatingLink}
          busyRelationId={busyRelationId}
          onUpdateRelation={handleUpdateRelation}
          onDeleteRelation={handleDeleteRelation}
        />
      ) : null}
    </div>
  );
}

function GraphZoomControls({ zoom }: { zoom: number }) {
  const { zoomIn, zoomOut, fitView } = useGraphViewport();
  return (
    <Panel position="bottom-right" className="!bottom-4 !right-4 !m-0">
      <div className="flex h-10 items-center overflow-hidden rounded-xl border border-white/10 bg-[#091923]/88 text-slate-300 shadow-xl backdrop-blur-xl">
        <button
          type="button"
          onClick={() => fitView()}
          className="grid h-full w-10 place-items-center border-r border-white/8 transition hover:bg-white/5 hover:text-primary"
          title="Уместить граф"
        >
          <Maximize2 className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomOut()}
          className="grid h-full w-10 place-items-center border-r border-white/8 transition hover:bg-white/5 hover:text-white"
          aria-label="Уменьшить"
        >
          <Minus className="size-4" />
        </button>
        <span className="min-w-14 px-2 text-center text-[11px] text-white">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomIn()}
          className="grid h-full w-10 place-items-center border-l border-white/8 transition hover:bg-white/5 hover:text-white"
          aria-label="Увеличить"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </Panel>
  );
}

function useGraphViewport() {
  const flow = useReactFlow<KnowledgeNode, KnowledgeEdge>();
  return {
    zoomIn: () => void flow.zoomIn({ duration: 180 }),
    zoomOut: () => void flow.zoomOut({ duration: 180 }),
    fitView: () => void flow.fitView({ duration: 320, padding: 0.2, maxZoom: 1.05 }),
  };
}

function GraphLegend() {
  const items: Array<{ type: GraphObjectType; label: string }> = [
    { type: "project", label: "Проект" },
    { type: "task", label: "Задача" },
    { type: "document", label: "Материал" },
    { type: "person", label: "Команда" },
    { type: "client", label: "Клиент" },
  ];
  return (
    <div className="flex items-center gap-5 rounded-xl border border-white/8 bg-[#091923]/76 px-4 py-2.5 text-[10px] text-slate-400 backdrop-blur-xl">
      {items.map((item) => (
        <span key={item.type} className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: GRAPH_TYPE_COLORS[item.type] }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

type GraphDetailsPanelProps = {
  entity: GraphEntity;
  model: GraphModel;
  relations: GraphRelation[];
  selectedNodeId: string;
  onClose: () => void;
  onRevealAll: () => void;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
  linkTargetQuery: string;
  onLinkTargetQueryChange: (value: string) => void;
  linkTargetId: string | null;
  onLinkTargetIdChange: (value: string) => void;
  linkTargetResults: GraphEntity[];
  linkType: GraphRelationType;
  onLinkTypeChange: (value: GraphRelationType) => void;
  linkDirection: GraphDirection;
  onLinkDirectionChange: (value: GraphDirection) => void;
  onSubmitLink: (event: FormEvent) => void;
  creatingLink: boolean;
  busyRelationId: string | null;
  onUpdateRelation: (
    relation: GraphRelation,
    relationType: GraphRelationType,
    direction: GraphDirection,
  ) => void;
  onDeleteRelation: (relation: GraphRelation) => void;
};

function GraphDetailsPanel(props: GraphDetailsPanelProps) {
  const directRelations = props.relations.filter((relation) =>
    relationTouches(relation, props.selectedNodeId),
  );
  const directEntities = directRelations
    .map((relation) => relatedNodeId(relation, props.selectedNodeId))
    .filter((nodeId): nodeId is string => Boolean(nodeId))
    .map((nodeId) => props.model.entities.get(nodeId))
    .filter((entity): entity is GraphEntity => Boolean(entity));

  const directCounts = new Map<GraphObjectType, number>();
  for (const entity of directEntities) {
    directCounts.set(entity.type, (directCounts.get(entity.type) ?? 0) + 1);
  }

  const nearby = getGraphDistances(props.selectedNodeId, props.relations, 3);
  const projectEntities = directEntities
    .filter((entity) => entity.type === "project")
    .filter((entity) => props.entity.type === "project" || entity.id !== props.entity.projectId)
    .slice(0, 4);

  const materialCandidates =
    props.entity.type === "project"
      ? [...nearby.keys()].map((nodeId) => props.model.entities.get(nodeId))
      : directEntities;
  const recentMaterials = materialCandidates
    .filter((entity): entity is GraphEntity => Boolean(entity) && MATERIAL_TYPES.has(entity.type))
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
    .slice(0, 4);

  const dependencies = directRelations.filter((relation) =>
    ["blocks", "depends_on", "requires_approval"].includes(relation.relationType),
  );
  const exchangeRelations = directRelations.filter(
    (relation) =>
      relation.direction === "two_way" ||
      props.relations.some(
        (candidate) =>
          candidate.id !== relation.id &&
          candidate.sourceType === relation.targetType &&
          candidate.sourceId === relation.targetId &&
          candidate.targetType === relation.sourceType &&
          candidate.targetId === relation.sourceId,
      ),
  );
  const sourceHref = entitySourceHref(props.entity);

  const project =
    props.entity.type === "project"
      ? props.entity
      : props.entity.projectId
        ? props.model.entities.get(graphNodeId("project", props.entity.projectId))
        : null;
  const progress = Number(props.entity.metadata?.["progress"] ?? 0);
  const Icon = NODE_ICON[props.entity.type] ?? Network;
  const color = GRAPH_TYPE_COLORS[props.entity.type];

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-[min(338px,calc(100%-1rem))] flex-col border-l border-white/8 bg-[#0a1a25]/96 shadow-[-24px_0_60px_-42px_rgba(0,0,0,.95)] backdrop-blur-xl xl:w-[338px]">
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <span>{project ? "Проекты" : GRAPH_OBJECT_LABELS[props.entity.type]}</span>
          {project ? (
            <>
              <ChevronRight className="size-3" />
              <span className="truncate text-sky-400">{project.title}</span>
            </>
          ) : null}
          <button
            type="button"
            onClick={props.onClose}
            className="ml-auto grid size-7 place-items-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-white"
            aria-label="Закрыть панель"
          >
            <PanelRightClose className="size-4" />
          </button>
        </div>

        <div className="mt-5 flex items-start gap-3">
          <div
            className="grid size-10 shrink-0 place-items-center rounded-xl border"
            style={{ color, borderColor: `${color}66`, backgroundColor: `${color}16` }}
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-[16px] font-semibold leading-tight text-white">
              {props.entity.title}
            </h2>
            <p className="mt-1 text-[10px] text-slate-500">
              {GRAPH_OBJECT_LABELS[props.entity.type]} ·{" "}
              {formatConnectionCount(directEntities.length)}
            </p>
          </div>
        </div>

        {props.entity.subtitle ? (
          <p className="mt-4 line-clamp-3 text-[11px] leading-5 text-slate-400">
            {props.entity.subtitle}
          </p>
        ) : null}

        {props.entity.type !== "project" ? (
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/7 bg-white/[0.025] p-3 text-[9px]">
            <span className="text-slate-600">Создан</span>
            <span className="text-right text-slate-400">
              {props.entity.createdAt
                ? new Date(props.entity.createdAt).toLocaleDateString("ru-RU")
                : "—"}
            </span>
            <span className="text-slate-600">Исходный проект</span>
            <span className="truncate text-right text-slate-400">
              {project?.title ?? "Без проекта"}
            </span>
            <span className="text-slate-600">Статус</span>
            <span className="truncate text-right text-slate-400">
              {props.entity.status ?? "Активен"}
            </span>
          </div>
        ) : null}

        {props.entity.type === "project" ? (
          <section className="mt-5">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Прогресс проекта</span>
              <span className="text-slate-200">{progress}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/6">
              <div
                className="h-full rounded-full bg-primary shadow-[0_0_14px_rgba(31,224,202,.55)]"
                style={{ width: `${Math.max(2, progress)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[9px] text-slate-500">
              Выполнено {String(props.entity.metadata?.["completedTasks"] ?? 0)} из{" "}
              {String(props.entity.metadata?.["taskCount"] ?? 0)} задач
            </p>
          </section>
        ) : null}

        <PanelSection title="Связано напрямую">
          {directCounts.size ? (
            [...directCounts.entries()].map(([type, count]) => (
              <div key={type} className="flex items-center gap-2.5 py-1.5 text-[11px]">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: GRAPH_TYPE_COLORS[type] }}
                />
                <span className="flex-1 text-slate-300">{GRAPH_OBJECT_LABELS[type]}</span>
                <span className="text-slate-500">{count}</span>
              </div>
            ))
          ) : (
            <p className="text-[10px] text-slate-500">Прямых связей пока нет.</p>
          )}
        </PanelSection>

        {projectEntities.length ? (
          <PanelSection title="Используется также">
            {projectEntities.map((item) => (
              <div key={item.id} className="flex items-center gap-2.5 py-1.5 text-[11px]">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: GRAPH_TYPE_COLORS.project }}
                />
                <span className="truncate text-slate-300">{item.title}</span>
              </div>
            ))}
          </PanelSection>
        ) : null}

        {exchangeRelations.length ? (
          <PanelSection title="Обмен связями">
            {exchangeRelations.slice(0, 5).map((relation) => {
              const otherId = relatedNodeId(relation, props.selectedNodeId);
              const other = otherId ? props.model.entities.get(otherId) : null;
              return (
                <div key={relation.id} className="flex items-center gap-2 py-1.5 text-[10px]">
                  <span className="size-2 rounded-full bg-primary/80" />
                  <span className="min-w-0 flex-1 truncate text-slate-400">
                    {other?.title ?? "Связанный объект"}
                  </span>
                  <ArrowRightLeft className="size-3 text-primary/70" />
                </div>
              );
            })}
          </PanelSection>
        ) : null}

        {recentMaterials.length ? (
          <PanelSection title="Последние материалы">
            {recentMaterials.map((item) => (
              <div
                key={graphNodeId(item.type, item.id)}
                className="flex items-center gap-2.5 py-1.5 text-[11px]"
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: GRAPH_TYPE_COLORS[item.type] }}
                />
                <span className="min-w-0 flex-1 truncate text-slate-300">{item.title}</span>
              </div>
            ))}
          </PanelSection>
        ) : null}

        {dependencies.length ? (
          <PanelSection title="Зависимости и блокировки">
            {dependencies.map((relation) => (
              <p key={relation.id} className="py-1 text-[10px] text-amber-200/80">
                {GRAPH_RELATION_LABELS[relation.relationType]}
              </p>
            ))}
          </PanelSection>
        ) : null}

        {directRelations.length ? (
          <PanelSection title="Управление связями">
            <div className="space-y-2">
              {directRelations.slice(0, 8).map((relation) => {
                const otherId = relatedNodeId(relation, props.selectedNodeId);
                const other = otherId ? props.model.entities.get(otherId) : null;
                const locked = relation.isAutomatic || relation.implicit;
                const busy = props.busyRelationId === relation.id;
                return (
                  <div
                    key={relation.id}
                    className="rounded-lg border border-white/7 bg-white/[0.02] px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2 text-[9px]">
                      <span className="min-w-0 flex-1 truncate text-slate-400">
                        {other?.title ?? "Связанный объект"}
                      </span>
                      {locked ? (
                        <span
                          className="flex items-center gap-1 text-slate-600"
                          title="Автоматическая связь"
                        >
                          <Lock className="size-3" />
                          авто
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => props.onDeleteRelation(relation)}
                          className="text-slate-600 transition hover:text-red-300 disabled:opacity-40"
                          aria-label="Удалить ручную связь"
                        >
                          {busy ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Trash2 className="size-3" />
                          )}
                        </button>
                      )}
                    </div>
                    {locked ? (
                      <p className="mt-1 text-[9px] text-slate-600">
                        {GRAPH_RELATION_LABELS[relation.relationType]}
                      </p>
                    ) : (
                      <div className="mt-2 flex gap-1.5">
                        <select
                          value={relation.relationType}
                          disabled={busy}
                          onChange={(event) =>
                            props.onUpdateRelation(
                              relation,
                              event.target.value as GraphRelationType,
                              relation.direction,
                            )
                          }
                          className="h-7 min-w-0 flex-1 rounded-md border border-white/8 bg-[#0a1822] px-1.5 text-[9px] text-slate-300 outline-none"
                        >
                          {RELATION_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {GRAPH_RELATION_LABELS[type]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            props.onUpdateRelation(
                              relation,
                              relation.relationType,
                              relation.direction === "two_way" ? "one_way" : "two_way",
                            )
                          }
                          className={cn(
                            "grid size-7 place-items-center rounded-md border border-white/8 text-slate-500",
                            relation.direction === "two_way" && "border-primary/30 text-primary",
                          )}
                          title={
                            relation.direction === "two_way" ? "Двусторонняя" : "Односторонняя"
                          }
                        >
                          <ArrowRightLeft className="size-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </PanelSection>
        ) : null}

        {props.composerOpen ? (
          <form
            onSubmit={(event) => void props.onSubmitLink(event)}
            className="mt-5 rounded-xl border border-primary/25 bg-primary/5 p-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white">Новая связь</h3>
              <button
                type="button"
                onClick={() => props.onComposerOpenChange(false)}
                className="text-slate-500 hover:text-white"
                aria-label="Закрыть"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <label className="mt-3 block text-[9px] uppercase tracking-[0.12em] text-slate-500">
              Тип связи
            </label>
            <select
              value={props.linkType}
              onChange={(event) => props.onLinkTypeChange(event.target.value as GraphRelationType)}
              className="mt-1.5 h-9 w-full rounded-lg border border-white/10 bg-[#0a1822] px-2.5 text-[11px] text-white outline-none focus:border-primary/50"
            >
              {RELATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {GRAPH_RELATION_LABELS[type]}
                </option>
              ))}
            </select>
            <label className="mt-3 block text-[9px] uppercase tracking-[0.12em] text-slate-500">
              Направление
            </label>
            <select
              value={props.linkDirection}
              onChange={(event) =>
                props.onLinkDirectionChange(event.target.value as GraphDirection)
              }
              className="mt-1.5 h-9 w-full rounded-lg border border-white/10 bg-[#0a1822] px-2.5 text-[11px] text-white outline-none focus:border-primary/50"
            >
              <option value="one_way">Односторонняя дуга</option>
              <option value="two_way">Две встречные дуги</option>
            </select>
            <label className="mt-3 block text-[9px] uppercase tracking-[0.12em] text-slate-500">
              Второй объект
            </label>
            <div className="relative mt-1.5">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" />
              <input
                value={props.linkTargetQuery}
                onChange={(event) => {
                  props.onLinkTargetQueryChange(event.target.value);
                  props.onLinkTargetIdChange("");
                }}
                placeholder="Название объекта"
                className="h-9 w-full rounded-lg border border-white/10 bg-[#0a1822] pl-8 pr-2.5 text-[11px] text-white outline-none focus:border-primary/50"
              />
            </div>
            <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
              {props.linkTargetResults.map((item) => {
                const id = graphNodeId(item.type, item.id);
                const active = props.linkTargetId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      props.onLinkTargetIdChange(id);
                      props.onLinkTargetQueryChange(item.title);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[10px] transition",
                      active
                        ? "bg-primary/12 text-primary"
                        : "text-slate-400 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: GRAPH_TYPE_COLORS[item.type] }}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="text-[8px] text-slate-600">
                      {GRAPH_OBJECT_LABELS[item.type]}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="submit"
              disabled={!props.linkTargetId || props.creatingLink}
              className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {props.creatingLink ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Link2 className="size-3.5" />
              )}
              Создать связь
            </button>
          </form>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-white/8 p-4">
        {sourceHref ? (
          <a
            href={sourceHref}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 text-[11px] font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            <ExternalLink className="size-3.5" />
            Открыть исходный объект
          </a>
        ) : null}
        <button
          type="button"
          onClick={props.onRevealAll}
          className="h-10 w-full rounded-xl border border-primary/60 text-[11px] font-medium text-primary transition hover:bg-primary/8"
        >
          Открыть все связи
        </button>
        <button
          type="button"
          onClick={() => props.onComposerOpenChange(!props.composerOpen)}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          <Plus className="size-3.5" />
          Добавить связь
        </button>
      </div>
    </aside>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-white/8 pt-4">
      <h3 className="mb-2 text-[11px] font-semibold text-white">{title}</h3>
      {children}
    </section>
  );
}

function getGraphDistances(
  rootNodeId: string,
  relations: GraphRelation[],
  maxDepth: number,
): Map<string, number> {
  const distances = new Map<string, number>([[rootNodeId, 0]]);
  let frontier = [rootNodeId];
  for (let level = 1; level <= maxDepth && frontier.length; level += 1) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const relation of relations) {
        if (!relationTouches(relation, nodeId)) continue;
        const neighbor = relatedNodeId(relation, nodeId);
        if (!neighbor || distances.has(neighbor)) continue;
        distances.set(neighbor, level);
        next.push(neighbor);
      }
    }
    frontier = next;
    if (distances.size >= 220) break;
  }
  return distances;
}

function calculateEntityPosition(
  entity: GraphEntity,
  model: GraphModel,
  saved: Map<string, GraphPosition>,
): GraphPosition {
  const key = graphNodeId(entity.type, entity.id);
  const persisted = saved.get(key);
  if (persisted) return persisted;
  if (typeof entity.positionX === "number" && typeof entity.positionY === "number") {
    return { x: entity.positionX, y: entity.positionY };
  }

  const projects = [...model.entities.values()].filter((item) => item.type === "project");
  const projectIndex = projects.findIndex((project) => project.id === entity.id);
  if (entity.type === "project") return projectPosition(projectIndex < 0 ? 0 : projectIndex);

  const project = entity.projectId
    ? projects.find((candidate) => candidate.id === entity.projectId)
    : findRelatedProject(entity, model);
  const projectBase = project
    ? projectPosition(
        Math.max(
          0,
          projects.findIndex((candidate) => candidate.id === project.id),
        ),
      )
    : { x: 520, y: 300 };

  if (entity.type === "task") {
    const siblings = [...model.entities.values()].filter(
      (candidate) => candidate.type === "task" && candidate.projectId === entity.projectId,
    );
    const index = Math.max(
      0,
      siblings.findIndex((candidate) => candidate.id === entity.id),
    );
    const column = index % 3;
    const row = Math.floor(index / 3);
    return {
      x: projectBase.x - 220 + column * 220,
      y: projectBase.y + 190 + row * 150,
    };
  }

  if (entity.type === "person") {
    const people = [...model.entities.values()].filter((candidate) => candidate.type === "person");
    const index = Math.max(
      0,
      people.findIndex((candidate) => candidate.id === entity.id),
    );
    return {
      x: projectBase.x - 170 + (index % 3) * 180,
      y: projectBase.y - 125 - Math.floor(index / 3) * 70,
    };
  }

  const parentTaskRelation = model.relations.find(
    (relation) =>
      relation.targetType === entity.type &&
      relation.targetId === entity.id &&
      relation.sourceType === "task",
  );
  if (parentTaskRelation) {
    const task = model.entities.get(graphNodeId("task", parentTaskRelation.sourceId));
    if (task) {
      const taskBase = calculateEntityPosition(task, model, saved);
      const hash = stableHash(entity.id);
      const angle = ((hash % 240) + 150) * (Math.PI / 180);
      const radius = 95 + (hash % 3) * 28;
      return {
        x: taskBase.x + Math.cos(angle) * radius,
        y: taskBase.y + 80 + Math.abs(Math.sin(angle) * radius),
      };
    }
  }

  const hash = stableHash(entity.id);
  return {
    x: projectBase.x - 210 + (hash % 5) * 105,
    y: projectBase.y + 390 + (Math.floor(hash / 5) % 3) * 90,
  };
}

function projectPosition(index: number): GraphPosition {
  return {
    x: 190 + (index % 4) * 255,
    y: 110 + Math.floor(index / 4) * 190,
  };
}

function connectedEntityPosition(
  entity: GraphEntity,
  project: GraphEntity,
  model: GraphModel,
): GraphPosition {
  const projects = [...model.entities.values()].filter((item) => item.type === "project");
  const projectIndex = Math.max(
    0,
    projects.findIndex((candidate) => candidate.id === project.id),
  );
  const base = projectPosition(projectIndex);
  const connected = [...model.entities.values()]
    .filter((candidate) => candidate.type !== "project" && candidate.projectId === project.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const index = Math.max(
    0,
    connected.findIndex(
      (candidate) => candidate.id === entity.id && candidate.type === entity.type,
    ),
  );
  const hashOffset = stableHash(`${entity.type}:${entity.id}`) % 5;
  const angle = ((index * 61 + hashOffset * 17 + 30) * Math.PI) / 180;
  const radius = 145 + (index % 3) * 34;
  return {
    x: base.x + Math.cos(angle) * radius,
    y: base.y + Math.sin(angle) * radius,
  };
}

function findRelatedProject(entity: GraphEntity, model: GraphModel): GraphEntity | null {
  const nodeId = graphNodeId(entity.type, entity.id);
  for (const relation of model.relations) {
    if (!relationTouches(relation, nodeId)) continue;
    const other = relatedNodeId(relation, nodeId);
    if (!other) continue;
    const candidate = model.entities.get(other);
    if (candidate?.type === "project") return candidate;
  }
  return null;
}

function projectColor(name: string, id: string): string {
  const normalized = name.toLocaleLowerCase("ru");
  if (
    normalized.includes("aybolit") ||
    normalized.includes("айболит") ||
    normalized.includes("лечение за рубежом")
  ) {
    return "#19d5c1";
  }
  if (normalized.includes("berrdo")) return "#dc6fd2";
  if (normalized.includes("osnova") || normalized.includes("основа")) return "#62d98b";
  const palette = [
    "#55a7e8",
    "#a77ae6",
    "#d18bc8",
    "#66b9a5",
    "#d2a85d",
    "#6e9fd7",
    "#bc7f9f",
    "#78ad72",
    "#9d91d8",
    "#4fb6bd",
  ];
  return palette[stableHash(id) % palette.length] ?? "#55a7e8";
}

function projectColorForEntity(entity: GraphEntity, model: GraphModel): string {
  if (entity.type === "project") {
    const stored = entity.metadata?.["project_color"];
    return typeof stored === "string" ? stored : projectColor(entity.title, entity.id);
  }
  const project = entity.projectId
    ? model.entities.get(graphNodeId("project", entity.projectId))
    : findRelatedProject(entity, model);
  return project ? projectColorForEntity(project, model) : GRAPH_TYPE_COLORS[entity.type];
}

function edgeColorForRelation(relation: GraphRelation, model: GraphModel): string {
  const source = model.entities.get(graphNodeId(relation.sourceType, relation.sourceId));
  const target = model.entities.get(graphNodeId(relation.targetType, relation.targetId));
  if (source?.type === "project") return projectColorForEntity(source, model);
  if (target?.type === "project") return projectColorForEntity(target, model);
  if (source) return projectColorForEntity(source, model);
  if (target) return projectColorForEntity(target, model);
  return "#1fe0ca";
}

function entitySourceHref(entity: GraphEntity): string | null {
  const url = entity.metadata?.["url"];
  if (typeof url === "string" && /^(https?:|\/)/.test(url)) return url;
  if (entity.type === "task") return `/tasks/${entity.id}`;
  if (entity.type === "project") return "/projects";
  if (entity.type === "client") return "/clients";
  if (entity.type === "finance" || entity.type === "finance_transaction") return "/finance";
  if (entity.projectId) return "/projects";
  return null;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function formatConnectionCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "связь"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "связи"
        : "связей";
  return `${count} ${word}`;
}
