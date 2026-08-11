import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Calendar as CalendarIcon,
  Columns3,
  LayoutGrid,
  Link2,
  List,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Unlink,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { TaskCalendar } from "@/components/crm/TaskCalendar";
import { TaskEditor } from "@/components/crm/TaskEditor";
import { useCrm } from "@/lib/crm-store";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_STATUSES,
  type Priority,
  type Task,
  type TaskStatus,
} from "@/lib/crm-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Задачи и карта проектов — Orbit CRM" },
      {
        name: "description",
        content: "Канбан, список и интерактивная карта связей проектов с полноценными задачами.",
      },
      { property: "og:title", content: "Задачи и карта проектов — Orbit CRM" },
      {
        property: "og:description",
        content: "Три режима работы: канбан-доска, список и граф связей проектов.",
      },
    ],
  }),
  component: TasksPage,
});

const priorityTone: Record<Priority, string> = {
  high: "bg-acc-4/15 text-acc-4",
  med: "bg-acc-3/15 text-acc-3",
  low: "bg-acc-2/15 text-acc-2",
};

function TasksPage() {
  const { tasks, projects, moveTask, isLoading, isMutating } = useCrm();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"kanban" | "list" | "graph" | "calendar">("kanban");
  const [creating, setCreating] = useState<{ dueDate?: string } | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const visibleTasks = useMemo(() => tasks.filter((task) => !task.archivedAt), [tasks]);

  return (
    <AppShell
      title="Задачи и проекты"
      subtitle={
        mode === "graph"
          ? "Канбан, список и карта связей"
          : mode === "calendar"
            ? "Календарь задач: месяц и неделя"
            : "Канбан, список и карта связей"
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-border bg-surface-2/60 p-1">
          {(
            [
              ["kanban", "Канбан", Columns3],
              ["list", "Список", List],
              ["graph", "Карта", Network],
              ["calendar", "Календарь", CalendarIcon],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition",
                mode === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCreating({})}
          disabled={isLoading || isMutating}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
        >
          <Plus className="size-4" /> Задача
        </button>
      </div>

      {isLoading && (
        <div className="panel p-6 text-sm text-muted-foreground">Загружаю задачи из Supabase…</div>
      )}

      {!isLoading && mode === "kanban" && (
        <div className="flex flex-col gap-5 overflow-x-auto pb-4 md:flex-row w-full items-start">
          {TASK_STATUSES.map((col) => {
            const items = visibleTasks.filter((task) => task.status === col);
            return (
              <div
                key={col}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOverCol(col);
                }}
                onDragLeave={() => setOverCol((current) => (current === col ? null : current))}
                onDrop={() => {
                  if (dragId) void moveTask(dragId, col);
                  setDragId(null);
                  setOverCol(null);
                }}
                className={cn(
                  "panel min-h-72 w-full flex-1 min-w-[280px] sm:min-w-[300px] lg:min-w-[320px] p-4 transition",
                  overCol === col && "border-primary/60 ring-1 ring-primary/40",
                )}
              >
                <div className="mb-4 flex items-center justify-between px-1">
                  <p className="text-sm font-semibold">{STATUS_LABEL[col]}</p>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {items.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => {
                        setDragId(task.id);
                        setIsDragging(true);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setTimeout(() => setIsDragging(false), 150);
                      }}
                      onClick={() => {
                        if (!isDragging) {
                          setEditingTask(task);
                        }
                      }}
                      className={cn(
                        "block cursor-pointer rounded-xl border border-border bg-surface-2/70 p-4 transition hover:border-primary/50 active:cursor-grabbing shadow-sm hover:shadow-md",
                        dragId === task.id && "opacity-40",
                      )}
                    >
                      <p className="line-clamp-3 text-sm font-medium leading-snug">{task.title}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 font-medium text-[11px]",
                            priorityTone[task.priority],
                          )}
                        >
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                        <span className="truncate max-w-[180px]">
                          {projects.find((project) => project.id === task.projectId)?.name ??
                            "Без проекта"}
                        </span>
                        {task.due && <span className="ml-auto text-[11px]">{task.due}</span>}
                      </div>
                      {(task.checklistItems.length > 0 || task.files.length > 0) && (
                        <div className="mt-2.5 flex items-center gap-3 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                          {task.checklistItems.length > 0 && (
                            <span>
                              Чек-лист:{" "}
                              {task.checklistItems.filter((item) => item.completedAt).length}/
                              {task.checklistItems.length}
                            </span>
                          )}
                          {task.files.length > 0 && <span>Файлов: {task.files.length}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                  {!items.length && (
                    <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                      Перетащите карточку сюда
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && mode === "list" && (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Задача</th>
                  <th className="px-4 py-3">Проект</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Исполнитель</th>
                  <th className="px-4 py-3">Приоритет</th>
                  <th className="px-4 py-3">Срок</th>
                  <th className="px-4 py-3">Чек-лист</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleTasks.map((task) => (
                  <tr key={task.id} className="transition hover:bg-surface-2/50">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setEditingTask(task)}
                        className="text-left font-medium transition hover:text-primary"
                      >
                        {task.title}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {projects.find((project) => project.id === task.projectId)?.name ??
                        "Без проекта"}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={task.status}
                        disabled={isMutating}
                        onChange={(event) =>
                          void moveTask(task.id, event.target.value as TaskStatus)
                        }
                        className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs outline-none"
                      >
                        {TASK_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {task.assigneeId ? task.assigneeId.slice(0, 8) : "Не назначен"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {PRIORITY_LABEL[task.priority]}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{task.due ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {task.checklistItems.length
                        ? `${task.checklistItems.filter((item) => item.completedAt).length}/${task.checklistItems.length}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isLoading && mode === "graph" && (
        <ProjectGraph tasks={visibleTasks} onSelectTask={(task) => setEditingTask(task)} />
      )}

      {!isLoading && mode === "calendar" && (
        <TaskCalendar
          onCreateDate={(dueDate) => setCreating({ dueDate })}
          onSelectTask={(task) => setEditingTask(task)}
        />
      )}

      {creating !== null && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => setCreating(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-in zoom-in-95"
          >
            <TaskEditor
              task={null}
              {...(creating.dueDate ? { initialDueDate: creating.dueDate } : {})}
              onClose={() => setCreating(null)}
              onSaved={(task) => {
                setCreating(null);
                setEditingTask(task);
              }}
            />
          </div>
        </div>
      )}

      {editingTask !== null && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => setEditingTask(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-in zoom-in-95"
          >
            <TaskEditor
              task={editingTask}
              onClose={() => setEditingTask(null)}
              onSaved={() => setEditingTask(null)}
              onDeleted={() => setEditingTask(null)}
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ProjectGraph({
  tasks,
  onSelectTask,
}: {
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}) {
  const { projects, updateProject } = useCrm();
  const activeProjects = useMemo(
    () => projects.filter((project) => !project.archivedAt),
    [projects],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(activeProjects[0]?.id ?? null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Node positions in percentage (0 to 100) within canvas container
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>(
    {},
  );
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Miro connection mode / rubberband line
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Auto-spread overlapping or uninitialized positions
  useEffect(() => {
    if (!activeProjects.length) return;

    setLocalPositions((prev) => {
      const next = { ...prev };
      let changed = false;

      const positionsCount: Record<string, number> = {};
      activeProjects.forEach((p) => {
        const posX = p.x ?? 50;
        const posY = p.y ?? 50;
        const key = `${Math.round(posX)},${Math.round(posY)}`;
        positionsCount[key] = (positionsCount[key] || 0) + 1;
      });

      const needsAutoSpread =
        Object.values(positionsCount).some((c) => c > 1) ||
        activeProjects.every((p) => (p.x === 50 && p.y === 50) || (!p.x && !p.y));

      activeProjects.forEach((p, idx) => {
        if (needsAutoSpread) {
          const angle = (idx / activeProjects.length) * 2 * Math.PI - Math.PI / 2;
          const radiusX = activeProjects.length > 3 ? 32 : 25;
          const radiusY = activeProjects.length > 3 ? 28 : 22;
          next[p.id] = {
            x: Math.round(50 + Math.cos(angle) * radiusX),
            y: Math.round(50 + Math.sin(angle) * radiusY),
          };
          changed = true;
        } else if (!next[p.id]) {
          next[p.id] = { x: p.x || 50, y: p.y || 50 };
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [activeProjects]);

  useEffect(() => {
    if (!activeProjects.length) {
      setSel(null);
      return;
    }
    if (!sel || !activeProjects.some((project) => project.id === sel)) {
      setSel(activeProjects[0]?.id ?? null);
    }
  }, [activeProjects, sel]);

  const autoDistributeNodes = () => {
    if (!activeProjects.length) return;
    const next: Record<string, { x: number; y: number }> = {};
    const total = activeProjects.length;
    activeProjects.forEach((p, idx) => {
      if (total === 1) {
        next[p.id] = { x: 50, y: 50 };
      } else {
        const angle = (idx / total) * 2 * Math.PI - Math.PI / 2;
        const radiusX = total > 4 ? 35 : 28;
        const radiusY = total > 4 ? 30 : 22;
        const newX = Math.round(50 + Math.cos(angle) * radiusX);
        const newY = Math.round(50 + Math.sin(angle) * radiusY);
        next[p.id] = { x: newX, y: newY };
        updateProject(p.id, { x: newX, y: newY });
      }
    });
    setLocalPositions(next);
  };

  const getCanvasCoords = (e: React.PointerEvent | MouseEvent) => {
    if (!containerRef.current) return { x: 50, y: 50 };
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left - pan.x;
    const clientY = e.clientY - rect.top - pan.y;
    const xPct = (clientX / (rect.width * zoom)) * 100;
    const yPct = (clientY / (rect.height * zoom)) * 100;
    return { x: xPct, y: yPct };
  };

  const handleNodePointerDown = (e: React.PointerEvent, projectId: string) => {
    if (connectingFromId) return;
    e.stopPropagation();
    setSel(projectId);
    setDraggingNodeId(projectId);

    const pos = localPositions[projectId] || { x: 50, y: 50 };
    const coords = getCanvasCoords(e);
    setDragOffset({ x: coords.x - pos.x, y: coords.y - pos.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const coords = getCanvasCoords(e);
    setMousePos(coords);

    if (draggingNodeId) {
      const newX = Math.round(coords.x - dragOffset.x);
      const newY = Math.round(coords.y - dragOffset.y);
      setLocalPositions((prev) => ({
        ...prev,
        [draggingNodeId]: { x: newX, y: newY },
      }));
    } else if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  };

  const handlePointerUp = () => {
    if (draggingNodeId) {
      const finalPos = localPositions[draggingNodeId];
      if (finalPos) {
        updateProject(draggingNodeId, { x: finalPos.x, y: finalPos.y });
      }
      setDraggingNodeId(null);
    }
    if (isPanning) {
      setIsPanning(false);
    }
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (connectingFromId) {
      setConnectingFromId(null);
      setMousePos(null);
      return;
    }
    if (e.target === containerRef.current || (e.target as HTMLElement).tagName === "svg") {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleStartLinking = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (connectingFromId === projectId) {
      setConnectingFromId(null);
      setMousePos(null);
    } else if (connectingFromId) {
      handleConnectProjects(connectingFromId, projectId);
      setConnectingFromId(null);
      setMousePos(null);
    } else {
      setConnectingFromId(projectId);
      setSel(projectId);
    }
  };

  const handleConnectProjects = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const sourceProject = activeProjects.find((p) => p.id === sourceId);
    if (!sourceProject) return;

    if (!sourceProject.links.includes(targetId)) {
      const updatedLinks = [...sourceProject.links, targetId];
      updateProject(sourceId, { links: updatedLinks });
    }
  };

  const handleRemoveLink = (sourceId: string, targetId: string) => {
    const sourceProject = activeProjects.find((p) => p.id === sourceId);
    if (!sourceProject) return;

    const updatedLinks = sourceProject.links.filter((id) => id !== targetId);
    updateProject(sourceId, { links: updatedLinks });
  };

  const activeProjectMap = useMemo(
    () => Object.fromEntries(activeProjects.map((p) => [p.id, p])),
    [activeProjects],
  );

  const selectedProject = activeProjects.find((p) => p.id === sel);
  const relatedTasks = sel ? tasks.filter((task) => task.projectId === sel) : [];

  if (!activeProjects.length) {
    return <div className="panel p-6 text-sm text-muted-foreground">Проекты пока не созданы.</div>;
  }

  return (
    <div
      className={cn(
        "grid gap-4 transition-all duration-300",
        isSidebarOpen ? "lg:grid-cols-[1fr_300px]" : "grid-cols-1",
      )}
    >
      <div className="panel relative flex flex-col min-h-[34rem] overflow-hidden select-none border border-border/70" style={{ background: "#0f172a" }}>
        {/* Canvas Toolbar Header */}
        <div className="z-10 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-[#0f172a]/90 p-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-white/90">
              <Network className="size-4 text-primary" />
              Карта связей
            </span>
            {connectingFromId && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary animate-pulse">
                <Link2 className="size-3" />
                Выберите проект для соединения...
                <button
                  type="button"
                  onClick={() => {
                    setConnectingFromId(null);
                    setMousePos(null);
                  }}
                  className="ml-1 hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={autoDistributeNodes}
              title="Автоматически распределить блоки"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium hover:bg-white/[0.08] transition text-slate-300"
            >
              <LayoutGrid className="size-3.5 text-slate-400" />
              Распределить
            </button>
            <button
              type="button"
              onClick={() => {
                if (selectedProject) {
                  if (connectingFromId === selectedProject.id) {
                    setConnectingFromId(null);
                    setMousePos(null);
                  } else {
                    setConnectingFromId(selectedProject.id);
                  }
                }
              }}
              disabled={!selectedProject}
              title="Связать проекты"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium hover:bg-white/[0.08] transition text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Link2 className="size-3.5 text-slate-400" />
              Связать
            </button>
            <div className="h-4 w-px bg-white/[0.08] mx-1" />
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.6, z + 0.15))}
              title="Увеличить"
              className="rounded-lg p-1.5 hover:bg-white/[0.08] transition text-slate-400 hover:text-white/90"
            >
              <ZoomIn className="size-4" />
            </button>
            <span className="text-[11px] font-mono w-9 text-center text-slate-400">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))}
              title="Уменьшить"
              className="rounded-lg p-1.5 hover:bg-white/[0.08] transition text-slate-400 hover:text-white/90"
            >
              <ZoomOut className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              title="Сбросить масштаб"
              className="rounded-lg p-1.5 hover:bg-white/[0.08] transition text-slate-400 hover:text-white/90"
            >
              <RotateCcw className="size-3.5" />
            </button>

            <div className="h-4 w-px bg-white/[0.08] mx-1" />
            <button
              type="button"
              onClick={() => setIsSidebarOpen((v) => !v)}
              title={isSidebarOpen ? "Скрыть панель" : "Показать панель"}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                isSidebarOpen
                  ? "border-white/[0.08] bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                  : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
              )}
            >
              {isSidebarOpen ? (
                <>
                  <PanelRightClose className="size-3.5" />
                  <span className="hidden sm:inline">Скрыть панель</span>
                </>
              ) : (
                <>
                  <PanelRightOpen className="size-3.5" />
                  <span>Панель</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Miro Canvas Space */}
        <div
          ref={containerRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerDown={handleCanvasPointerDown}
          className={cn(
            "relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing min-h-[28rem]",
            connectingFromId && "cursor-crosshair",
          )}
          style={{
            backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.12) 1px, transparent 1px)",
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        >
          <div
            className="absolute inset-0 size-full transition-transform duration-75 origin-top-left"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            {/* SVG Connections Canvas */}
            <svg className="absolute inset-0 size-full pointer-events-none overflow-visible">
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="8"
                  refX="16"
                  refY="4"
                  orient="auto"
                >
                  <polygon points="0 0, 10 4, 0 8" fill="var(--primary)" />
                </marker>
                <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <filter id="glow-strong" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feFlood floodColor="var(--primary)" floodOpacity="0.3" result="color" />
                  <feComposite in="color" in2="blur" operator="in" result="colorBlur" />
                  <feComposite in="SourceGraphic" in2="colorBlur" operator="over" />
                </filter>
              </defs>

              {/* Render Existing Links */}
              {containerRef.current &&
                (() => {
                  const width = containerRef.current.clientWidth;
                  const height = containerRef.current.clientHeight;

                  return activeProjects.flatMap((project) => {
                    const sourcePos = localPositions[project.id] || {
                      x: project.x || 50,
                      y: project.y || 50,
                    };
                    const x1 = (sourcePos.x / 100) * width;
                    const y1 = (sourcePos.y / 100) * height;

                    return project.links.map((targetId) => {
                      const targetProject = activeProjectMap[targetId];
                      if (!targetProject) return null;
                      const targetPos = localPositions[targetId] || {
                        x: targetProject.x || 50,
                        y: targetProject.y || 50,
                      };

                      const x2 = (targetPos.x / 100) * width;
                      const y2 = (targetPos.y / 100) * height;
                      const midX = (x1 + x2) / 2;
                      const midY = (y1 + y2) / 2 - 25;

                      const isHighlighted = sel === project.id || sel === targetId;

                      return (
                        <g
                          key={`link-${project.id}-${targetId}`}
                          className="group pointer-events-auto"
                        >
                          {/* Outer glow stroke */}
                          <path
                            d={`M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`}
                            stroke={isHighlighted ? "var(--primary)" : (project.color || "var(--primary)")}
                            strokeWidth={isHighlighted ? "6" : "4"}
                            strokeOpacity={isHighlighted ? "0.25" : "0.12"}
                            fill="none"
                            className="transition-all"
                            filter={isHighlighted ? "url(#glow-strong)" : undefined}
                          />
                          {/* Main line */}
                          <path
                            d={`M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`}
                            stroke={isHighlighted ? "var(--primary)" : (project.color || "var(--primary)")}
                            strokeWidth={isHighlighted ? "2" : "1.5"}
                            strokeOpacity={isHighlighted ? "1" : "0.6"}
                            fill="none"
                            markerEnd="url(#arrowhead)"
                            className="transition-all"
                          />
                        </g>
                      );
                    });
                  });
                })()}

              {/* Temporary Link Line while connecting */}
              {connectingFromId &&
                mousePos &&
                containerRef.current &&
                (() => {
                  const width = containerRef.current.clientWidth;
                  const height = containerRef.current.clientHeight;
                  const sourcePos = localPositions[connectingFromId] || { x: 50, y: 50 };
                  const x1 = (sourcePos.x / 100) * width;
                  const y1 = (sourcePos.y / 100) * height;
                  const x2 = (mousePos.x / 100) * width;
                  const y2 = (mousePos.y / 100) * height;

                  return (
                    <g className="pointer-events-none">
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="var(--primary)"
                        strokeWidth="3"
                        strokeDasharray="8 6"
                        className="animate-pulse"
                        filter="url(#glow)"
                      />
                      <circle
                        cx={x2}
                        cy={y2}
                        r="6"
                        fill="var(--primary)"
                        className="animate-ping"
                      />
                    </g>
                  );
                })()}
            </svg>

            {/* Render Interactive Nodes */}
            {activeProjects.map((project) => {
              const pos = localPositions[project.id] || { x: project.x || 50, y: project.y || 50 };
              const activeCount = tasks.filter(
                (task) => task.projectId === project.id && task.status !== "completed",
              ).length;

              const isSelected = sel === project.id;
              const isSource = connectingFromId === project.id;
              const isTargetHovered =
                connectingFromId && connectingFromId !== project.id && hoveredNodeId === project.id;

              return (
                <div
                  key={project.id}
                  onPointerDown={(e) => handleNodePointerDown(e, project.id)}
                  onMouseEnter={() => setHoveredNodeId(project.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={(e) => {
                    if (connectingFromId && connectingFromId !== project.id) {
                      e.stopPropagation();
                      handleConnectProjects(connectingFromId, project.id);
                      setConnectingFromId(null);
                      setMousePos(null);
                    }
                  }}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 group min-w-[11rem] max-w-[14rem] rounded-xl border bg-[#1e293b]/95 p-3 shadow-lg backdrop-blur-md transition-all cursor-grab active:cursor-grabbing hover:z-20",
                    "border-white/[0.08]",
                    isSelected && "ring-2 ring-primary border-primary/80 shadow-[0_0_20px_rgba(16,185,129,0.15)]",
                    isSource && "ring-2 ring-primary animate-pulse border-primary",
                    isTargetHovered && "ring-2 ring-emerald-400 border-emerald-400 scale-105 shadow-[0_0_20px_rgba(52,211,153,0.2)]",
                    draggingNodeId === project.id && "z-30 scale-105 shadow-2xl opacity-90",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2 mb-2">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span
                        className="size-2.5 rounded-full shrink-0 shadow-[0_0_6px_currentColor]"
                        style={{ backgroundColor: project.color || "var(--primary)", color: project.color || "var(--primary)" }}
                      />
                      <span className="font-semibold text-xs sm:text-sm truncate text-white/90">
                        {project.name}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handleStartLinking(e, project.id)}
                      title={isSource ? "Отмена соединения" : "Соединить с другим проектом"}
                      className={cn(
                        "rounded-md p-1 transition text-slate-400 hover:text-primary hover:bg-white/[0.06]",
                        isSource && "bg-primary/20 text-primary",
                      )}
                    >
                      <Link2 className="size-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{activeCount} активных задач</span>
                    {project.links.length > 0 && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
                        <ArrowRight className="size-3" />
                        {project.links.length} {project.links.length === 1 ? "связь" : "связи"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sidebar Task List & Links Inspector */}
      {isSidebarOpen && (
        <div className="panel p-0 flex flex-col h-full animate-in fade-in slide-in-from-right-2 duration-200 overflow-hidden">
          {/* Sidebar Header */}
          <div className="p-4 border-b border-border/60">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm sm:text-base font-semibold text-foreground truncate">
                  {selectedProject?.name ?? "Выберите проект"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {selectedProject?.description || "Управление задачами и связями проекта"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selectedProject && (
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: selectedProject.color || "var(--primary)" }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(false)}
                  title="Закрыть панель"
                  className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-surface-2 transition"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Connected Projects */}
            {selectedProject && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Связи
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground bg-surface-2/60 px-1.5 py-0.5 rounded">
                    {selectedProject.links.length}
                  </span>
                </div>
                {selectedProject.links.length > 0 ? (
                  <div className="space-y-1.5">
                    {selectedProject.links.map((linkId) => {
                      const target = activeProjectMap[linkId];
                      if (!target) return null;
                      return (
                        <div
                          key={linkId}
                          className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface-2/30 px-2.5 py-2 text-xs"
                        >
                          <span
                            className="size-2 rounded-full shrink-0"
                            style={{ backgroundColor: target.color }}
                          />
                          <span className="flex-1 truncate text-foreground">{target.name}</span>
                          <Link2 className="size-3 text-muted-foreground" />
                          <button
                            type="button"
                            onClick={() => handleRemoveLink(selectedProject.id, linkId)}
                            title="Удалить связь"
                            className="text-muted-foreground hover:text-destructive transition"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border/60 rounded-lg">
                    Нет связей
                  </p>
                )}
              </div>
            )}

            {/* Project Tasks */}
            {selectedProject && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Задачи
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground bg-surface-2/60 px-1.5 py-0.5 rounded">
                    {relatedTasks.length}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-[18rem] overflow-y-auto pr-1">
                  {relatedTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onSelectTask(task)}
                      className="block w-full rounded-lg border border-border/60 bg-surface-2/30 hover:bg-surface-2/60 px-2.5 py-2 text-left text-xs transition hover:border-primary/50 group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground group-hover:text-primary transition truncate">
                          {task.title}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider shrink-0",
                            priorityTone[task.priority],
                          )}
                        >
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                      </div>
                      <span className="block text-[10px] text-muted-foreground mt-1">
                        {STATUS_LABEL[task.status]}
                      </span>
                    </button>
                  ))}
                  {!relatedTasks.length && (
                    <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border/60 rounded-lg">
                      В этом проекте пока нет задач.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Footer - Create Link Button */}
          {selectedProject && (
            <div className="p-4 border-t border-border/60">
              <button
                type="button"
                onClick={() => {
                  if (connectingFromId === selectedProject.id) {
                    setConnectingFromId(null);
                    setMousePos(null);
                  } else {
                    setConnectingFromId(selectedProject.id);
                    setSel(selectedProject.id);
                  }
                }}
                className={cn(
                  "w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
                  connectingFromId === selectedProject.id
                    ? "bg-surface-2 border border-border text-foreground hover:bg-surface-2/80"
                    : "bg-primary text-primary-foreground hover:opacity-90 shadow-[0_0_16px_rgba(16,185,129,0.2)]",
                )}
              >
                <Link2 className="size-4" />
                {connectingFromId === selectedProject.id ? "Отменить" : "Создать связь"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
