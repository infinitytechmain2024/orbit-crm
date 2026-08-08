import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Archive } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { TaskEditor } from "@/components/crm/TaskEditor";
import { useCrm } from "@/lib/crm-store";
import { STATUS_LABEL } from "@/lib/crm-data";

export const Route = createFileRoute("/tasks/$taskId")({
  head: () => ({
    meta: [
      { title: "Задача — Orbit CRM" },
      {
        name: "description",
        content: "Постоянная карточка задачи Orbit CRM с чек-листом, подзадачами и вложениями.",
      },
    ],
  }),
  component: TaskDetailsPage,
});

function TaskDetailsPage() {
  const { taskId } = Route.useParams();
  const navigate = useNavigate();
  const { tasks, isLoading, refreshTask } = useCrm();
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const task = tasks.find((item) => item.id === taskId) ?? null;

  useEffect(() => {
    if (isLoading || task || requestedId === taskId) return;
    setRequestedId(taskId);
    void refreshTask(taskId);
  }, [isLoading, refreshTask, requestedId, task, taskId]);

  return (
    <AppShell
      title={task?.title ?? "Задача"}
      subtitle={
        task ? `${STATUS_LABEL[task.status]} · ${task.due ?? "без дедлайна"}` : "Карточка задачи"
      }
    >
      {isLoading && <div className="panel p-6 text-sm text-muted-foreground">Загружаю задачу…</div>}

      {!isLoading && !task && (
        <div className="panel p-6">
          <h2 className="text-lg font-semibold">Задача не найдена</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Возможно, она была удалена или у вас нет доступа к этой организации.
          </p>
        </div>
      )}

      {task && (
        <div className="panel p-6">
          {task.archivedAt && (
            <div className="mb-4 inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm text-muted-foreground">
              <Archive className="size-4" />
              Архивирована {new Date(task.archivedAt).toLocaleString("ru-RU")}
            </div>
          )}
          <TaskEditor
            task={task}
            onSaved={() => undefined}
            onDeleted={() => void navigate({ to: "/tasks" })}
          />
        </div>
      )}
    </AppShell>
  );
}
