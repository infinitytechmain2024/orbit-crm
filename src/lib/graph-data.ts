import type { Tables } from "@/lib/supabase/database.types";
import type {
  OrganizationMember,
  Project,
  Task,
  TaskChecklistItem,
  TaskComment,
  TaskFile,
  TaskLabel,
  Tx,
} from "@/lib/crm-data";

export type GraphObjectType =
  | "project"
  | "task"
  | "person"
  | "client"
  | "site"
  | "page"
  | "document"
  | "note"
  | "prompt"
  | "generation"
  | "image"
  | "file"
  | "comment"
  | "email"
  | "decision"
  | "approval"
  | "finance_transaction"
  | "request"
  | "task_label"
  | "checklist_item";

export type GraphRelationType =
  | "belongs_to"
  | "contains"
  | "assigned_to"
  | "created_from"
  | "uses"
  | "used_in"
  | "related_to"
  | "requires_approval"
  | "blocks"
  | "depends_on"
  | "generated_from_prompt";

export type GraphEntity = {
  id: string;
  type: GraphObjectType;
  title: string;
  subtitle?: string;
  projectId?: string | null;
  createdAt?: string;
  createdBy?: string | null;
  status?: string;
  metadata?: Record<string, string | number | null | undefined>;
};

export type GraphRelation = {
  id: string;
  sourceType: GraphObjectType;
  sourceId: string;
  targetType: GraphObjectType;
  targetId: string;
  relationType: GraphRelationType;
  createdAt: string;
  createdBy: string | null;
  implicit: boolean;
};

export type GraphModel = {
  entities: Map<string, GraphEntity>;
  relations: GraphRelation[];
};

export type GraphLead = Pick<
  Tables<"leads">,
  | "id"
  | "company_name"
  | "website"
  | "status"
  | "project_id"
  | "responsible_user_id"
  | "created_at"
  | "source_query"
>;

export const GRAPH_OBJECT_LABELS: Record<GraphObjectType, string> = {
  project: "Проект",
  task: "Задача",
  person: "Человек",
  client: "Клиент",
  site: "Сайт",
  page: "Страница",
  document: "Документ",
  note: "Заметка",
  prompt: "Промпт",
  generation: "Генерация",
  image: "Изображение",
  file: "Файл",
  comment: "Комментарий",
  email: "Письмо",
  decision: "Решение",
  approval: "Согласование",
  finance_transaction: "Финансы",
  request: "Заявка",
  task_label: "Метка",
  checklist_item: "Пункт чек-листа",
};

export const GRAPH_RELATION_LABELS: Record<GraphRelationType, string> = {
  belongs_to: "принадлежит",
  contains: "содержит",
  assigned_to: "назначено",
  created_from: "создано из",
  uses: "использует",
  used_in: "используется в",
  related_to: "связано",
  requires_approval: "требует утверждения",
  blocks: "блокирует",
  depends_on: "зависит от",
  generated_from_prompt: "создано из промпта",
};

export const GRAPH_TYPE_COLORS: Record<GraphObjectType, string> = {
  project: "#19d5c1",
  task: "#48b77a",
  person: "#3b96f3",
  client: "#37c7df",
  site: "#2ea8f0",
  page: "#4c8fe9",
  document: "#8d72d8",
  note: "#a687df",
  prompt: "#a36bdb",
  generation: "#f29a37",
  image: "#eea43b",
  file: "#8f78d8",
  comment: "#9c83da",
  email: "#5e86dc",
  decision: "#5bb889",
  approval: "#dbb04c",
  finance_transaction: "#efa43b",
  request: "#65b8a2",
  task_label: "#4e92ed",
  checklist_item: "#55ba81",
};

export function graphNodeId(type: GraphObjectType, id: string): string {
  return `${type}:${id}`;
}

function implicitId(parts: Array<string | null | undefined>): string {
  return `implicit:${parts.filter(Boolean).join(":")}`;
}

function fileType(file: TaskFile): GraphObjectType {
  if (file.mimeType.startsWith("image/")) return "image";
  if (
    file.mimeType.includes("pdf") ||
    file.mimeType.includes("word") ||
    file.mimeType.includes("sheet") ||
    file.mimeType.includes("excel") ||
    file.mimeType === "text/plain"
  ) {
    return "document";
  }
  return "file";
}

function addEntity(target: Map<string, GraphEntity>, entity: GraphEntity) {
  target.set(graphNodeId(entity.type, entity.id), entity);
}

function addRelation(
  target: GraphRelation[],
  relation: Omit<GraphRelation, "id" | "implicit"> & { id?: string },
) {
  target.push({
    ...relation,
    id:
      relation.id ??
      implicitId([
        relation.sourceType,
        relation.sourceId,
        relation.relationType,
        relation.targetType,
        relation.targetId,
      ]),
    implicit: true,
  });
}

function addChecklistEntity(
  entities: Map<string, GraphEntity>,
  relations: GraphRelation[],
  task: Task,
  item: TaskChecklistItem,
) {
  addEntity(entities, {
    id: item.id,
    type: "checklist_item",
    title: item.title,
    subtitle: item.completedAt ? "Выполнено" : "В работе",
    projectId: task.projectId,
    createdAt: item.createdAt,
    status: item.completedAt ? "completed" : "active",
  });
  addRelation(relations, {
    sourceType: "task",
    sourceId: task.id,
    targetType: "checklist_item",
    targetId: item.id,
    relationType: "contains",
    createdAt: item.createdAt,
    createdBy: task.authorId,
  });
}

function addCommentEntity(
  entities: Map<string, GraphEntity>,
  relations: GraphRelation[],
  task: Task,
  comment: TaskComment,
) {
  const compactBody = comment.body.replace(/\s+/g, " ").trim();
  addEntity(entities, {
    id: comment.id,
    type: "comment",
    title: compactBody.length > 54 ? `${compactBody.slice(0, 51)}…` : compactBody,
    subtitle: "Комментарий к задаче",
    projectId: task.projectId,
    createdAt: comment.createdAt,
    createdBy: comment.createdBy,
  });
  addRelation(relations, {
    sourceType: "task",
    sourceId: task.id,
    targetType: "comment",
    targetId: comment.id,
    relationType: "contains",
    createdAt: comment.createdAt,
    createdBy: comment.createdBy,
  });
}

function addFileEntity(
  entities: Map<string, GraphEntity>,
  relations: GraphRelation[],
  task: Task,
  file: TaskFile,
) {
  const type = fileType(file);
  addEntity(entities, {
    id: file.id,
    type,
    title: file.fileName,
    subtitle: file.mimeType,
    projectId: task.projectId,
    createdAt: file.createdAt,
    createdBy: file.uploadedBy,
    metadata: { sizeBytes: file.sizeBytes },
  });
  addRelation(relations, {
    sourceType: "task",
    sourceId: task.id,
    targetType: type,
    targetId: file.id,
    relationType: "contains",
    createdAt: file.createdAt,
    createdBy: file.uploadedBy,
  });
}

function addLabelEntity(
  entities: Map<string, GraphEntity>,
  relations: GraphRelation[],
  task: Task,
  label: TaskLabel,
) {
  addEntity(entities, {
    id: label.id,
    type: "task_label",
    title: label.name,
    subtitle: "Метка задачи",
    projectId: task.projectId,
    metadata: { color: label.color },
  });
  addRelation(relations, {
    sourceType: "task",
    sourceId: task.id,
    targetType: "task_label",
    targetId: label.id,
    relationType: "uses",
    createdAt: task.updatedAt,
    createdBy: task.authorId,
  });
}

export function buildGraphModel(input: {
  projects: Project[];
  tasks: Task[];
  members: OrganizationMember[];
  txs: Tx[];
  leads?: GraphLead[];
}): GraphModel {
  const entities = new Map<string, GraphEntity>();
  const relations: GraphRelation[] = [];

  for (const member of input.members) {
    addEntity(entities, {
      id: member.userId,
      type: "person",
      title: member.fullName || member.email || "Участник команды",
      subtitle: member.role,
      metadata: { email: member.email, avatarUrl: member.avatarUrl },
    });
  }

  for (const project of input.projects) {
    const projectTasks = input.tasks.filter((task) => task.projectId === project.id);
    const completedTasks = projectTasks.filter((task) => task.status === "completed").length;
    addEntity(entities, {
      id: project.id,
      type: "project",
      title: project.name,
      subtitle: project.description || "Проект",
      projectId: project.id,
      createdAt: project.createdAt,
      createdBy: project.createdBy,
      status: project.status,
      metadata: {
        color: project.color,
        priority: project.priority,
        dueDate: project.dueDate,
        taskCount: projectTasks.length,
        completedTasks,
        progress: projectTasks.length
          ? Math.round((completedTasks / projectTasks.length) * 100)
          : 0,
      },
    });

    for (const memberId of project.memberIds) {
      if (!entities.has(graphNodeId("person", memberId))) continue;
      addRelation(relations, {
        sourceType: "project",
        sourceId: project.id,
        targetType: "person",
        targetId: memberId,
        relationType: "assigned_to",
        createdAt: project.updatedAt,
        createdBy: project.createdBy,
      });
    }

    for (const linkedProjectId of project.links) {
      if (!input.projects.some((candidate) => candidate.id === linkedProjectId)) continue;
      addRelation(relations, {
        sourceType: "project",
        sourceId: project.id,
        targetType: "project",
        targetId: linkedProjectId,
        relationType: "related_to",
        createdAt: project.updatedAt,
        createdBy: project.createdBy,
      });
    }
  }

  for (const task of input.tasks) {
    addEntity(entities, {
      id: task.id,
      type: "task",
      title: task.title,
      subtitle: task.description || task.note || "Задача",
      projectId: task.projectId,
      createdAt: task.createdAt,
      createdBy: task.authorId,
      status: task.status,
      metadata: {
        priority: task.priority,
        dueDate: task.dueDate,
        checklistCount: task.checklistItems.length,
        commentCount: task.comments.length,
        fileCount: task.files.length,
      },
    });

    if (task.projectId && entities.has(graphNodeId("project", task.projectId))) {
      addRelation(relations, {
        sourceType: "project",
        sourceId: task.projectId,
        targetType: "task",
        targetId: task.id,
        relationType: "contains",
        createdAt: task.createdAt,
        createdBy: task.authorId,
      });
    }

    if (task.parentTaskId && input.tasks.some((candidate) => candidate.id === task.parentTaskId)) {
      addRelation(relations, {
        sourceType: "task",
        sourceId: task.id,
        targetType: "task",
        targetId: task.parentTaskId,
        relationType: "depends_on",
        createdAt: task.createdAt,
        createdBy: task.authorId,
      });
    }

    for (const assigneeId of task.assigneeIds) {
      if (!entities.has(graphNodeId("person", assigneeId))) continue;
      addRelation(relations, {
        sourceType: "task",
        sourceId: task.id,
        targetType: "person",
        targetId: assigneeId,
        relationType: "assigned_to",
        createdAt: task.updatedAt,
        createdBy: task.authorId,
      });
    }

    for (const label of task.labels) addLabelEntity(entities, relations, task, label);
    for (const item of task.checklistItems) addChecklistEntity(entities, relations, task, item);
    for (const comment of task.comments) addCommentEntity(entities, relations, task, comment);
    for (const file of task.files) addFileEntity(entities, relations, task, file);
  }

  for (const transaction of input.txs) {
    if (!transaction.taskId || !entities.has(graphNodeId("task", transaction.taskId))) continue;
    addEntity(entities, {
      id: transaction.id,
      type: "finance_transaction",
      title: transaction.label,
      subtitle: `${transaction.amount.toLocaleString("ru-RU")} · ${transaction.category}`,
      createdAt: transaction.dateIso,
      status: transaction.type,
      metadata: { amount: transaction.amount, category: transaction.category },
    });
    addRelation(relations, {
      sourceType: "task",
      sourceId: transaction.taskId,
      targetType: "finance_transaction",
      targetId: transaction.id,
      relationType: "contains",
      createdAt: transaction.dateIso,
      createdBy: null,
    });
  }

  for (const lead of input.leads ?? []) {
    addEntity(entities, {
      id: lead.id,
      type: "client",
      title: lead.company_name || "Клиент",
      subtitle: lead.website || lead.source_query || "Клиент",
      projectId: lead.project_id,
      createdAt: lead.created_at,
      status: lead.status,
    });
    if (lead.project_id && entities.has(graphNodeId("project", lead.project_id))) {
      addRelation(relations, {
        sourceType: "project",
        sourceId: lead.project_id,
        targetType: "client",
        targetId: lead.id,
        relationType: "contains",
        createdAt: lead.created_at,
        createdBy: null,
      });
    }
    if (lead.responsible_user_id && entities.has(graphNodeId("person", lead.responsible_user_id))) {
      addRelation(relations, {
        sourceType: "client",
        sourceId: lead.id,
        targetType: "person",
        targetId: lead.responsible_user_id,
        relationType: "assigned_to",
        createdAt: lead.created_at,
        createdBy: null,
      });
    }
  }

  return { entities, relations: dedupeRelations(relations) };
}

export function dedupeRelations(relations: GraphRelation[]): GraphRelation[] {
  const seen = new Set<string>();
  return relations.filter((relation) => {
    const endpoints = [
      `${relation.sourceType}:${relation.sourceId}`,
      `${relation.targetType}:${relation.targetId}`,
    ];
    if (relation.relationType === "related_to") endpoints.sort();
    const key = `${endpoints.join(":")}:${relation.relationType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function relationTouches(relation: GraphRelation, nodeId: string): boolean {
  return (
    graphNodeId(relation.sourceType, relation.sourceId) === nodeId ||
    graphNodeId(relation.targetType, relation.targetId) === nodeId
  );
}

export function relatedNodeId(relation: GraphRelation, nodeId: string): string | null {
  const source = graphNodeId(relation.sourceType, relation.sourceId);
  const target = graphNodeId(relation.targetType, relation.targetId);
  if (source === nodeId) return target;
  if (target === nodeId) return source;
  return null;
}
