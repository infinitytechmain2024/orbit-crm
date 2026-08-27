import { DragEvent, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, SquareMousePointer, Clock } from "lucide-react";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfToday,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { ru } from "date-fns/locale";
import { useCrm } from "@/lib/crm-store";
import {
  DEFAULT_TASK_FILTERS,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_STATUSES,
  filterTasks,
  type Priority,
  type Project,
  type Task,
  type TaskFilters,
  type TaskPatch,
  todayLocalIsoDate,
} from "@/lib/crm-data";
import { cn } from "@/lib/utils";
import { QuickTaskModal } from "./QuickTaskModal";

const WEEK_STARTS_ON = 1;
const WEEKDAYS: string[] = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const priorityDot: Record<Priority, string> = {
  high: "bg-acc-4",
  med: "bg-acc-3",
  low: "bg-acc-2",
};

function localDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseLocalDate(iso: string): Date {
  const parts = iso.split("-").map(Number);
  const y = parts[0] ?? 0;
  const mo = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, mo - 1, d);
}

function taskMatchesDate(task: Task, iso: string): boolean {
  const start = task.startDate;
  const due = task.dueDate;
  if (start && due) return start <= iso && iso <= due;
  if (start) return start === iso;
  if (due) return due === iso;
  return false;
}

function capitalize(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export type CalendarViewMode = "month" | "week" | "day";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

type TaskCalendarProps = {
  onCreateDate: (dueDate: string) => void;
  onSelectTask: (task: Task) => void;
};

export function TaskCalendar({ onCreateDate, onSelectTask }: TaskCalendarProps) {
  const { tasks, updateTask, isMutating, isLoading } = useCrm();
  const visibleTasks = useMemo(() => tasks.filter((task) => !task.archivedAt), [tasks]);

  const [view, setView] = useState<CalendarViewMode>("month");
  const [currentDate, setCurrentDate] = useState<Date>(startOfToday());
  const [filters, setFilters] = useState<TaskFilters>({ ...DEFAULT_TASK_FILTERS });
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [quickTaskModal, setQuickTaskModal] = useState<{
    open: boolean;
    date: string;
    hour?: number;
  }>({
    open: false,
    date: todayLocalIsoDate(),
  });

  const today = todayLocalIsoDate();

  const gridTasks = useMemo(
    () => filterTasks(visibleTasks, filters).filter((task) => task.startDate || task.dueDate),
    [visibleTasks, filters],
  );

  const noDateTasks = useMemo(
    () =>
      filterTasks(visibleTasks, { ...filters, dateFrom: "", dateTo: "" }).filter(
        (task) => !task.startDate && !task.dueDate,
      ),
    [visibleTasks, filters],
  );

  const navigate = (dir: -1 | 1) => {
    setCurrentDate((current) => {
      if (view === "month") return dir === -1 ? subMonths(current, 1) : addMonths(current, 1);
      if (view === "week") return dir === -1 ? subWeeks(current, 1) : addWeeks(current, 1);
      return dir === -1 ? addDays(current, -1) : addDays(current, 1);
    });
  };

  const goToday = () => setCurrentDate(startOfToday());

  const headerLabel = useMemo(() => {
    if (view === "month") {
      return capitalize(format(currentDate, "LLLL yyyy", { locale: ru }));
    }
    if (view === "week") {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON });
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: WEEK_STARTS_ON });
      return `${format(weekStart, "d MMM", { locale: ru })} — ${format(weekEnd, "d MMM", { locale: ru })}, ${capitalize(format(weekStart, "LLLL yyyy", { locale: ru }))}`;
    }
    return capitalize(format(currentDate, "EEEE, d MMMM yyyy", { locale: ru }));
  }, [view, currentDate]);

  const handleDragStart = (id: string) => {
    setDraggedId(id);
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    window.setTimeout(() => setIsDragging(false), 150);
  };

  const dragOver = (event: DragEvent<HTMLDivElement>) => event.preventDefault();

  const handleDateDrop = async (targetIso: string) => {
    if (!draggedId) return;
    const task = visibleTasks.find((item) => item.id === draggedId);
    if (!task) return;

    const patch: TaskPatch = {};
    if (task.startDate && task.dueDate) {
      const duration = differenceInCalendarDays(
        parseLocalDate(task.dueDate),
        parseLocalDate(task.startDate),
      );
      patch.startDate = targetIso;
      patch.dueDate = localDateStr(addDays(parseLocalDate(targetIso), duration));
    } else if (task.dueDate) {
      patch.dueDate = targetIso;
    } else if (task.startDate) {
      patch.startDate = targetIso;
    } else {
      patch.dueDate = targetIso;
    }

    await updateTask(task.id, patch);
    setDraggedId(null);
  };

  const handleTimeDrop = async (targetDate: string, targetHour: number) => {
    if (!draggedId) return;
    const task = visibleTasks.find((item) => item.id === draggedId);
    if (!task) return;

    const patch: TaskPatch = {};
    if (task.startDate && task.dueDate) {
      const duration = differenceInCalendarDays(
        parseLocalDate(task.dueDate),
        parseLocalDate(task.startDate),
      );
      patch.startDate = targetDate;
      patch.dueDate = localDateStr(addDays(parseLocalDate(targetDate), duration));
    } else if (task.dueDate) {
      patch.dueDate = targetDate;
    } else if (task.startDate) {
      patch.startDate = targetDate;
    } else {
      patch.dueDate = targetDate;
    }

    // Store time info in tags for display purposes (since DB doesn't have time fields yet)
    const timeTag = `${String(targetHour).padStart(2, "0")}:00`;
    const existingTimeTag = task.tags.find((t) => t.includes(":"));
    const newTags = task.tags.filter((t) => !t.includes(":")).concat(timeTag);
    patch.tags = newTags;

    await updateTask(task.id, patch);
    setDraggedId(null);
  };

  const handleCellClick = (date: string, hour?: number) => {
    if (isMutating) return;
    setQuickTaskModal({ open: true, date, hour });
  };

  const handleQuickTaskSaved = () => {
    setQuickTaskModal({ open: false, date: todayLocalIsoDate() });
  };

  const resetFilters = () => setFilters({ ...DEFAULT_TASK_FILTERS });

  const activeFilters =
    Boolean(filters.search) ||
    filters.status !== "all" ||
    filters.priority !== "all" ||
    filters.projectId !== "all" ||
    filters.assigneeId !== "all" ||
    filters.overdue === "overdue";

  return (
    <div className="space-y-4">
      <QuickTaskModal
        open={quickTaskModal.open}
        onClose={() => setQuickTaskModal({ open: false, date: todayLocalIsoDate() })}
        initialDate={quickTaskModal.date}
        initialHour={quickTaskModal.hour}
        onSaved={handleQuickTaskSaved}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            disabled={isMutating}
            className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground transition hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            disabled={isMutating}
            className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground transition hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            disabled={isMutating}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:border-primary/50"
          >
            Сегодня
          </button>
          <h2 className="ml-2 text-lg font-semibold">{headerLabel}</h2>
        </div>

        <div className="flex gap-1 rounded-xl border border-border bg-surface-2/40 p-1">
          {(["month", "week", "day"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-medium transition",
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "month" ? "Месяц" : v === "week" ? "Неделя" : "День"}
            </button>
          ))}
        </div>
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        onReset={resetFilters}
        active={activeFilters}
      />

      {isLoading && (
        <div className="panel p-6 text-sm text-muted-foreground">Загружаю задачи из Supabase…</div>
      )}

      {!isLoading && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex-1 min-w-0">
            {view === "month" && (
              <MonthView
                currentDate={currentDate}
                tasks={gridTasks}
                draggedId={draggedId}
                isDragging={isDragging}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                dragOver={dragOver}
                onDateDrop={handleDateDrop}
                onCreateDate={onCreateDate}
                onSelectTask={onSelectTask}
                isMutating={isMutating}
                today={today}
                onCellClick={handleCellClick}
              />
            )}
            {view === "week" && (
              <WeekView
                currentDate={currentDate}
                tasks={gridTasks}
                draggedId={draggedId}
                isDragging={isDragging}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                dragOver={dragOver}
                onDateDrop={handleDateDrop}
                onTimeDrop={handleTimeDrop}
                onCreateDate={onCreateDate}
                onSelectTask={onSelectTask}
                isMutating={isMutating}
                today={today}
                onCellClick={handleCellClick}
              />
            )}
            {view === "day" && (
              <DayView
                currentDate={currentDate}
                tasks={gridTasks}
                draggedId={draggedId}
                isDragging={isDragging}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                dragOver={dragOver}
                onTimeDrop={handleTimeDrop}
                onCreateDate={onCreateDate}
                onSelectTask={onSelectTask}
                isMutating={isMutating}
                today={today}
                onCellClick={handleCellClick}
              />
            )}
          </div>

          <div className="w-full max-w-xs flex-shrink-0 lg:max-w-sm">
            <NoDatePanel
              tasks={noDateTasks}
              draggedId={draggedId}
              isDragging={isDragging}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onSelectTask={onSelectTask}
              onCreateDate={onCreateDate}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
  onReset,
  active,
}: {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  onReset: () => void;
  active: boolean;
}) {
  const { projects, members } = useCrm();
  const update = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <input
        type="search"
        value={filters.search}
        onChange={(event) => update("search", event.target.value)}
        placeholder="Поиск по задаче, описанию, тегам…"
        className="w-full min-w-[18rem] rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
      />
      <select
        value={filters.status}
        onChange={(event) => update("status", event.target.value as TaskFilters["status"])}
        className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
      >
        <option value="all">Все статусы</option>
        {TASK_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status]}
          </option>
        ))}
      </select>
      <select
        value={filters.priority}
        onChange={(event) => update("priority", event.target.value as TaskFilters["priority"])}
        className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
      >
        <option value="all">Все приоритеты</option>
        {TASK_PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {PRIORITY_LABEL[priority]}
          </option>
        ))}
      </select>
      <select
        value={filters.projectId}
        onChange={(event) => update("projectId", event.target.value)}
        className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
      >
        <option value="all">Все проекты</option>
        <option value="__none">Без проекта</option>
        {projects
          .filter((project) => !project.archivedAt)
          .map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
      </select>
      <select
        value={filters.assigneeId}
        onChange={(event) => update("assigneeId", event.target.value)}
        className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
      >
        <option value="all">Все исполнители</option>
        <option value="__none">Без исполнителя</option>
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.fullName || member.email || member.userId.slice(0, 8)}
          </option>
        ))}
      </select>
      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={filters.overdue === "overdue"}
          onChange={(event) => update("overdue", event.target.checked ? "overdue" : "all")}
          className="size-4 accent-primary"
        />
        Просроченные
      </label>
      {active && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:text-foreground"
        >
          Сбросить
        </button>
      )}
    </div>
  );
}

function TaskChip({
  task,
  draggedId,
  isDragging,
  onDragStart,
  onDragEnd,
  onSelectTask,
}: {
  task: Task;
  draggedId: string | null;
  isDragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onSelectTask: (task: Task) => void;
}) {
  const { projects } = useCrm();
  const project = task.projectId ? projects.find((item) => item.id === task.projectId) : null;
  const isRange = Boolean(task.startDate) && Boolean(task.dueDate);
  const indicatorColor = project?.color ?? priorityDot[task.priority];

  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      onClick={(event) => {
        event.stopPropagation();
        if (!isDragging) onSelectTask(task);
      }}
      className={cn(
        "group mb-1 flex w-full cursor-grab items-center gap-1.5 rounded-lg border border-border bg-surface-2/70 px-2 py-1.5 text-xs text-left transition hover:border-primary/50 active:cursor-grabbing",
        draggedId === task.id && "opacity-40",
      )}
      title={task.title}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: indicatorColor }}
      />
      <span className="block min-w-0 flex-1 truncate">{task.title}</span>
      {isRange && <span className="shrink-0 text-[10px] text-muted-foreground">период</span>}
    </button>
  );
}

function EmptyCell({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-0.5 flex w-full items-center justify-center gap-1 rounded border border-dashed border-border px-1 py-0.5 text-[10px] text-muted-foreground opacity-0 transition hover:border-primary/50 hover:text-primary group-hover:opacity-100"
    >
      <Plus className="size-3" />+ задача
    </button>
  );
}

type SharedViewProps = {
  currentDate: Date;
  tasks: Task[];
  draggedId: string | null;
  isDragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  dragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDateDrop: (iso: string) => void;
  onTimeDrop?: (date: string, hour: number) => void;
  onCreateDate: (date: string) => void;
  onSelectTask: (task: Task) => void;
  isMutating: boolean;
  today: string;
  onCellClick?: (date: string, hour?: number) => void;
};

function MonthView({
  currentDate,
  tasks,
  today,
  isMutating,
  onCellClick,
  ...rest
}: SharedViewProps) {
  const monthStart = startOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: WEEK_STARTS_ON });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div className="panel overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="border-r border-border py-2 text-center text-xs font-medium text-muted-foreground last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const cellDate = localDateStr(day);
          const inMonth = day.getMonth() === currentDate.getMonth();
          const isToday = cellDate === today;
          const tasksHere = tasks.filter((task) => taskMatchesDate(task, cellDate));
          const onDateClick = () => {
            if (isMutating) return;
            onCellClick?.(cellDate);
          };
          return (
            <div
              key={cellDate}
              className={cn(
                "relative min-h-[5.5rem] group border-b border-r border-border p-1 align-top last:border-r-0",
                !inMonth && "bg-surface-2/20",
                isToday && "bg-primary/5",
              )}
              onDragOver={rest.dragOver}
              onDrop={() => rest.onDateDrop(cellDate)}
            >
              <span
                className={cn(
                  "mb-1 block text-xs",
                  inMonth ? "text-muted-foreground" : "text-muted-foreground/50",
                  isToday && "font-semibold text-primary",
                )}
              >
                {day.getDate()}
              </span>
              <div className="space-y-0.5 overflow-hidden">
                {tasksHere.map((task) => (
                  <TaskChip
                    key={task.id}
                    task={task}
                    draggedId={rest.draggedId}
                    isDragging={rest.isDragging}
                    onDragStart={rest.onDragStart}
                    onDragEnd={rest.onDragEnd}
                    onSelectTask={rest.onSelectTask}
                  />
                ))}
                {tasksHere.length === 0 && (
                  <EmptyCell disabled={isMutating} onClick={onDateClick} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  currentDate,
  tasks,
  today,
  isMutating,
  onCellClick,
  onTimeDrop,
  ...rest
}: SharedViewProps) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON });
  const days = eachDayOfInterval({
    start: weekStart,
    end: endOfWeek(weekStart, { weekStartsOn: WEEK_STARTS_ON }),
  });

  return (
    <div className="panel overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {days.map((day) => {
          const cellDate = localDateStr(day);
          return (
            <div key={cellDate} className="border-r border-border p-2 text-center last:border-r-0">
              <span className="block text-xs text-muted-foreground">
                {capitalize(format(day, "EEEE", { locale: ru }))}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold",
                  cellDate === today ? "text-primary" : "text-foreground",
                )}
              >
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const cellDate = localDateStr(day);
          const isToday = cellDate === today;
          const tasksHere = tasks.filter((task) => taskMatchesDate(task, cellDate));
          return (
            <div
              key={cellDate}
              className={cn(
                "relative min-h-[12rem] group border-b border-r border-border p-1 last:border-r-0",
                isToday && "bg-primary/5",
              )}
            >
              <div className="space-y-0.5 overflow-hidden max-h-[calc(12rem-2rem)] overflow-y-auto">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    onDragOver={rest.dragOver}
                    onDrop={() => onTimeDrop?.(cellDate, hour)}
                    className="h-5 border-b border-border/30 px-0.5 transition hover:bg-primary/5 relative group"
                    style={{ minHeight: "24px" }}
                  >
                    <span className="absolute left-1 top-0 text-[9px] text-muted-foreground/50">
                      {String(hour).padStart(2, "0")}:00
                    </span>
                    {tasksHere
                      .filter((task) => getTaskHour(task) === hour)
                      .map((task) => (
                        <TaskChip
                          key={task.id}
                          task={task}
                          draggedId={rest.draggedId}
                          isDragging={rest.isDragging}
                          onDragStart={rest.onDragStart}
                          onDragEnd={rest.onDragEnd}
                          onSelectTask={rest.onSelectTask}
                        />
                      ))}
                  </div>
                ))}
              </div>
              {tasksHere.length === 0 && (
                <div className="mt-1 flex items-center justify-center">
                  <EmptyCell disabled={isMutating} onClick={() => onCellClick?.(cellDate)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getTaskHour(task: Task): number {
  const timeTag = task.tags.find((t) => t.includes(":"));
  if (timeTag) {
    const hour = parseInt(timeTag.split(":")[0], 10);
    return isNaN(hour) ? 9 : hour;
  }
  return 9;
}

function DayView({
  currentDate,
  tasks,
  today,
  isMutating,
  onCellClick,
  onTimeDrop,
  ...rest
}: SharedViewProps) {
  const dayDate = localDateStr(currentDate);
  const isToday = dayDate === today;
  const tasksHere = tasks.filter((task) => taskMatchesDate(task, dayDate));

  return (
    <div className="panel overflow-hidden">
      <div className="grid grid-cols-2 border-b border-border">
        <div className="border-r border-border p-2 text-center">
          <span className="text-sm font-semibold">
            {isToday ? "Сегодня" : capitalize(format(currentDate, "EEEE", { locale: ru }))}
          </span>
          <span className="block text-xs text-muted-foreground mt-1">
            {capitalize(format(currentDate, "d MMMM yyyy", { locale: ru }))}
          </span>
        </div>
        <div className="p-2 text-center">
          <button
            type="button"
            onClick={() => onCellClick?.(dayDate)}
            className="text-xs text-muted-foreground hover:text-primary transition"
          >
            + Задача на этот день
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2">
        <div className="border-r border-border h-full">
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="h-10 border-b border-border px-2 pt-1 text-[10px] text-muted-foreground flex items-center"
            >
              <span className="w-12 text-right pr-2">{String(hour).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>
        <div className="relative min-h-[600px]">
          {HOURS.map((hour) => (
            <div
              key={hour}
              onDragOver={rest.dragOver}
              onDrop={() => onTimeDrop?.(dayDate, hour)}
              className="h-10 border-b border-border p-1 transition hover:bg-primary/5 relative"
              style={{ minHeight: "40px" }}
            >
              <div className="absolute inset-0 flex flex-col space-y-0.5 p-0.5">
                {tasksHere
                  .filter((task) => getTaskHour(task) === hour)
                  .map((task) => (
                    <TaskChip
                      key={task.id}
                      task={task}
                      draggedId={rest.draggedId}
                      isDragging={rest.isDragging}
                      onDragStart={rest.onDragStart}
                      onDragEnd={rest.onDragEnd}
                      onSelectTask={rest.onSelectTask}
                    />
                  ))}
              </div>
              {tasksHere.filter((task) => getTaskHour(task) === hour).length === 0 && (
                <button
                  type="button"
                  onClick={() => onCellClick?.(dayDate, hour)}
                  className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition"
                  disabled={isMutating}
                >
                  <Plus className="size-4 text-muted-foreground" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NoDatePanel({
  tasks,
  draggedId,
  isDragging,
  onDragStart,
  onDragEnd,
  onSelectTask,
  onCreateDate,
}: {
  tasks: Task[];
  draggedId: string | null;
  isDragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onSelectTask: (task: Task) => void;
  onCreateDate: (date: string) => void;
}) {
  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <SquareMousePointer className="size-4 text-muted-foreground" />
          Без даты
        </h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Перетащите задачу на день, чтобы назначить дедлайн.
      </p>
      <div className="space-y-1.5 overflow-y-auto pr-1">
        {tasks.map((task) => (
          <TaskChip
            key={task.id}
            task={task}
            draggedId={draggedId}
            isDragging={isDragging}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onSelectTask={onSelectTask}
          />
        ))}
        {!tasks.length && <p className="text-sm text-muted-foreground">Задач без даты нет.</p>}
      </div>
      <button
        type="button"
        onClick={() => onCreateDate(todayLocalIsoDate())}
        className="mt-auto inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <Plus className="size-4" />
        Создать задачу
      </button>
    </div>
  );
}
