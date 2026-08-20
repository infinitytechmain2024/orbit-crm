import { Mic, Plus, Search } from "lucide-react";

import type { WorkflowProject } from "./types";

export function WorkflowToolbar({
  projects,
  projectId,
  search,
  onProjectChange,
  onSearchChange,
  onCreate,
  onVoice,
}: {
  projects: WorkflowProject[];
  projectId: string;
  search: string;
  onProjectChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onVoice: () => void;
}) {
  return (
    <div className="flex basis-full flex-wrap items-center gap-2 xl:basis-auto">
      <label className="relative min-w-36 flex-1 sm:flex-none">
        <span className="sr-only">Фильтр по проекту</span>
        <select
          value={projectId}
          onChange={(event) => onProjectChange(event.target.value)}
          className="h-10 w-full appearance-none rounded-xl border border-border bg-surface-2/90 px-3 pr-8 text-xs font-medium text-foreground outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/15 sm:w-40"
        >
          <option value="all">Все проекты</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
          ⌄
        </span>
      </label>

      <label className="relative order-last min-w-full flex-1 sm:order-none sm:min-w-64 xl:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Поиск задач, проектов, агентов…"
          className="h-10 w-full rounded-xl border border-border bg-surface-2/90 pl-9 pr-12 text-xs text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary/70 focus:ring-2 focus:ring-primary/15"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[9px] text-muted-foreground">
          ⌘K
        </kbd>
      </label>

      <button
        type="button"
        onClick={onCreate}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#24d7c8] to-[#27bff4] px-4 text-xs font-semibold text-[#04212a] shadow-[0_0_28px_-12px_rgba(35,211,202,.9)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Plus className="size-4" />
        Новая задача
      </button>
      <button
        type="button"
        onClick={onVoice}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-surface-2/90 px-4 text-xs font-medium text-foreground transition hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Mic className="size-4" />
        <span className="hidden sm:inline">Записать задачу</span>
        <span className="sm:hidden">Записать</span>
      </button>
    </div>
  );
}
