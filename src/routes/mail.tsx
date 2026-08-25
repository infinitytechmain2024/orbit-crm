import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Archive, CornerUpLeft, ListPlus, Mail, Pencil, Send, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { useCrm } from "@/lib/crm-store";
import { sendReply, sendMessage } from "@/lib/agentmail";
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
  const { emails, markRead, addTask, organization } = useCrm();
  const [selId, setSelId] = useState(emails[0]?.id ?? "");
  const [flash, setFlash] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
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

  const handleReply = async () => {
    if (!sel || !replyText.trim() || !organization) return;
    if (!window.confirm("Отправить этот ответ через AgentMail?")) return;
    setIsSending(true);
    try {
      await sendReply({
        organizationId: organization.id,
        messageId: sel.id,
        text: replyText.trim(),
      });
      setFlash("Ответ отправлен");
      setReplyText("");
      setIsReplyOpen(false);
    } catch {
      setFlash("Ошибка отправки ответа");
    } finally {
      setIsSending(false);
      setTimeout(() => setFlash(null), 2600);
    }
  };

  const handleCompose = async () => {
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim() || !organization) return;
    if (!window.confirm(`Отправить письмо получателю ${composeTo.trim()}?`)) return;
    setIsSending(true);
    try {
      await sendMessage({
        organizationId: organization.id,
        to: composeTo.trim(),
        subject: composeSubject.trim(),
        text: composeBody.trim(),
        labels: ["outreach"],
      });
      setFlash("Письмо отправлено");
      setIsComposeOpen(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
    } catch {
      setFlash("Ошибка отправки письма");
    } finally {
      setIsSending(false);
      setTimeout(() => setFlash(null), 2600);
    }
  };

  return (
    <AppShell title="Почта" subtitle={`${emails.filter((e) => e.unread).length} непрочитанных`}>
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-medium">Входящие</span>
            <button
              onClick={() => setIsComposeOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-acc-1 to-acc-2 px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
            >
              <Pencil className="size-3" /> Написать
            </button>
          </div>
          {emails.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                setSelId(e.id);
                markRead(e.id);
                setIsReplyOpen(false);
                setReplyText("");
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

              {isReplyOpen && (
                <div className="mt-4 rounded-xl border border-border bg-surface-2/40 p-4">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Ответ для <span className="font-medium text-foreground">{sel.from}</span>
                  </p>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Напишите ответ..."
                    rows={4}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => void handleReply()}
                      disabled={isSending || !replyText.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-acc-1 to-acc-2 px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                    >
                      <Send className="size-4" /> {isSending ? "Отправка…" : "Отправить"}
                    </button>
                    <button
                      onClick={() => {
                        setIsReplyOpen(false);
                        setReplyText("");
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-auto flex gap-2 pt-6">
                <button
                  onClick={() => {
                    setIsReplyOpen(!isReplyOpen);
                    if (!isReplyOpen) setReplyText("");
                  }}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition",
                    isReplyOpen
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <CornerUpLeft className="size-4" /> {isReplyOpen ? "Скрыть ответ" : "Ответить"}
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

      {isComposeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Новое письмо</h3>
              <button
                onClick={() => setIsComposeOpen(false)}
                className="rounded-lg p-1 text-muted-foreground transition hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Кому</label>
                <input
                  type="email"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Тема</label>
                <input
                  type="text"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder="Тема письма"
                  className="w-full rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Текст</label>
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  placeholder="Напишите сообщение..."
                  rows={6}
                  className="w-full rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setIsComposeOpen(false)}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
              >
                Отмена
              </button>
              <button
                onClick={() => void handleCompose()}
                disabled={
                  isSending || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()
                }
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-acc-1 to-acc-2 px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                <Send className="size-4" /> {isSending ? "Отправка…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {flash && (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-xl border border-primary/40 bg-surface px-4 py-2 text-sm shadow-xl animate-in slide-in-from-bottom-2">
          {flash}
        </div>
      )}
    </AppShell>
  );
}
