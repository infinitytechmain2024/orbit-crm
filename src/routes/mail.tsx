import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Archive, CornerUpLeft, ListPlus, Mail, Sparkles, Trash2 } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { useCrm } from "@/lib/crm-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mail")({
  head: () => ({
    meta: [
      { title: "Почта — Orbit CRM" },
      {
        name: "description",
        content:
          "Почтовый хаб личной CRM: просмотр писем и превращение письма в задачу одним кликом.",
      },
      { property: "og:title", content: "Почта — Orbit CRM" },
      { property: "og:description", content: "Читайте письма и превращайте их в задачи." },
    ],
  }),
  component: MailPage,
});

function MailPage() {
  const { emails, markRead, addTask } = useCrm();
  const [selId, setSelId] = useState(emails[0]?.id ?? "");
  const [flash, setFlash] = useState<string | null>(null);
  const sel = emails.find((e) => e.id === selId);

  const toTask = async () => {
    if (!sel) return;
    const task = await addTask({
      title: sel.subject,
      note: `Из письма от ${sel.from}\n\n${sel.body}`,
      status: "backlog",
      priority: "high",
      tags: ["почта"],
    });
    if (!task) return;
    setFlash(`Задача «${sel.subject}» создана`);
    setTimeout(() => setFlash(null), 2600);
  };

  return (
    <AppShell title="Почта" subtitle={`${emails.filter((e) => e.unread).length} непрочитанных`}>
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="panel overflow-hidden">
          {emails.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                setSelId(e.id);
                markRead(e.id);
              }}
              className={cn(
                "flex w-full gap-3 border-b border-border px-4 py-3 text-left transition hover:bg-surface-2/60",
                selId === e.id && "bg-surface-2/80",
              )}
            >
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  e.unread ? "bg-primary" : "bg-transparent",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cn("truncate text-sm", e.unread && "font-semibold")}>
                    {e.from}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {e.date}
                  </span>
                </span>
                <span className="block truncate text-sm">{e.subject}</span>
                <span className="block truncate text-xs text-muted-foreground">{e.preview}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="panel flex min-h-[26rem] flex-col p-6">
          {sel ? (
            <>
              <div className="flex flex-wrap items-start gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
                  <Mail className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold">{sel.subject}</h2>
                  <p className="text-xs text-muted-foreground">
                    {sel.from} · {sel.date}
                  </p>
                </div>
                <button
                  onClick={() => void toTask()}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-acc-1 to-acc-2 px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  <ListPlus className="size-4" /> Превратить в задачу
                </button>
              </div>

              <p className="mt-6 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                {sel.body}
              </p>

              <div className="mt-6 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
                <p className="flex items-center gap-2 text-xs text-primary">
                  <Sparkles className="size-3.5" /> Сводка ИИ
                </p>
                <p className="mt-1 text-muted-foreground">
                  Отправитель ждёт ответа. Ключевое действие — подготовить и отправить обновление до
                  конца недели.
                </p>
              </div>

              <div className="mt-auto flex gap-2 pt-6">
                <button className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground">
                  <CornerUpLeft className="size-4" /> Ответить
                </button>
                <button className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground">
                  <Archive className="size-4" /> В архив
                </button>
                <button className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-destructive">
                  <Trash2 className="size-4" /> Удалить
                </button>
              </div>
            </>
          ) : (
            <p className="m-auto text-sm text-muted-foreground">Выберите письмо</p>
          )}
        </div>
      </div>

      {flash && (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-xl border border-primary/40 bg-surface px-4 py-2 text-sm shadow-xl animate-in slide-in-from-bottom-2">
          {flash}
        </div>
      )}
    </AppShell>
  );
}
