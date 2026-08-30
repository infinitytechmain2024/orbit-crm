import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronRight, Clock3, MessageSquarePlus, Send, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatMessage[];
};

const STORAGE_KEY = "orbit-ai-workflow-chat-threads";

function makeId() {
  return crypto.randomUUID();
}

function loadThreads(): ChatThread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatThread[]) : [];
  } catch {
    return [];
  }
}

function buildAssistantReply(text: string) {
  const trimmed = text.trim();
  const compact = trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
  return `Принято. Я зафиксировал задачу и отправляю её в AI Workflow: ${compact}`;
}

export function WorkflowChatPanel({
  onCreateTask,
}: {
  onCreateTask: (title: string, description: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads());
  const [activeThreadId, setActiveThreadId] = useState<string | null>(threads[0]?.id ?? null);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    if (!activeThreadId && threads[0]) {
      setActiveThreadId(threads[0].id);
    }
  }, [activeThreadId, threads]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads],
  );
  const activeThreadIndex = useMemo(
    () => threads.findIndex((thread) => thread.id === activeThreadId),
    [activeThreadId, threads],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeThread?.messages.length, open]);

  const createThread = () => {
    const thread: ChatThread = {
      id: makeId(),
      title: "Новый чат",
      createdAt: new Date().toISOString(),
      messages: [],
    };
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
  };

  const updateThread = (threadId: string, updater: (thread: ChatThread) => ChatThread) => {
    setThreads((current) =>
      current.map((thread) => (thread.id === threadId ? updater(thread) : thread)),
    );
  };

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || isSending) return;

    const thread =
      activeThread ??
      (() => {
        const next: ChatThread = {
          id: makeId(),
          title: content.slice(0, 42) || "Новый чат",
          createdAt: new Date().toISOString(),
          messages: [],
        };
        setThreads((current) => [next, ...current]);
        setActiveThreadId(next.id);
        return next;
      })();

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: ChatMessage = {
      id: makeId(),
      role: "assistant",
      content: buildAssistantReply(content),
      createdAt: new Date().toISOString(),
    };

    setIsSending(true);
    setDraft("");
    updateThread(thread.id, (current) => ({
      ...current,
      title: current.title === "Новый чат" ? content.slice(0, 42) || current.title : current.title,
      messages: [...current.messages, userMessage, assistantMessage],
    }));

    try {
      await onCreateTask(content, `Задача создана из скрытого AI Workflow чата.\n\n${content}`);
    } finally {
      setIsSending(false);
    }
  };

  const clearHistory = () => {
    setThreads([]);
    setActiveThreadId(null);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 rounded-full border-border bg-surface-2/70 text-xs shadow-sm transition hover:border-primary/40 hover:bg-surface-2"
        >
          <MessageSquarePlus className="h-4 w-4" />
          Чаты
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[100vw] border-border bg-background p-0 sm:w-[min(94vw,50rem)] lg:w-[min(96vw,68rem)]"
      >
        <div className="flex h-full min-h-0 flex-col animate-in fade-in-0 slide-in-from-right-3 duration-300">
          <SheetHeader className="border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
            <SheetTitle className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-4 w-4" />
              </span>
              Скрытый AI чат
            </SheetTitle>
            <SheetDescription>
              Диалоги живут только в AI Workflow и создают задачи в фоне.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside className="border-b border-border bg-surface/40 p-3 md:h-full md:w-[18rem] md:flex-shrink-0 md:border-b-0 md:border-r">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  История
                </span>
                <button
                  type="button"
                  onClick={createThread}
                  className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
                >
                  Новый
                </button>
              </div>
              <div className="max-h-[28vh] space-y-2 overflow-y-auto pr-1 md:max-h-none md:flex-1">
                {threads.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-background/40 p-4 text-sm text-muted-foreground">
                    Пока нет чатов. Создайте первый скрытый диалог.
                  </div>
                ) : (
                  threads.map((thread, index) => {
                    const active = thread.id === activeThreadId;
                    return (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => setActiveThreadId(thread.id)}
                        className={cn(
                          "group flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition-all duration-200",
                          active
                            ? "border-primary/40 bg-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                            : "border-border bg-background/60 hover:border-primary/25 hover:bg-surface-2/70",
                        )}
                        style={{ animationDelay: `${index * 40}ms` }}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{thread.title}</div>
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock3 className="h-3 w-3" />
                            {thread.messages.length} сообщений
                          </div>
                        </div>
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                            active && "translate-x-0.5 text-primary",
                            !active && "group-hover:translate-x-0.5",
                          )}
                        />
                      </button>
                    );
                  })
                )}
              </div>
              <button
                type="button"
                onClick={clearHistory}
                className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground transition hover:text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Очистить историю
              </button>
            </aside>

            <section className="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.03),transparent_36%)]">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {activeThread?.title ?? "Выберите чат"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {activeThread
                      ? `${activeThread.messages.length} сообщений`
                      : "Чат будет создан при первом сообщении"}
                  </div>
                </div>
                <div className="shrink-0 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] text-muted-foreground">
                  Hidden mode {activeThreadIndex >= 0 ? `#${activeThreadIndex + 1}` : ""}
                </div>
              </div>

              <div className="min-h-[38vh] flex-1 space-y-3 overflow-y-auto p-4 md:min-h-0">
                {!activeThread ? (
                  <div className="grid min-h-[32vh] place-items-center rounded-3xl border border-dashed border-border bg-background/40 px-4 text-center text-sm text-muted-foreground md:min-h-full">
                    Выберите чат слева или создайте новый.
                  </div>
                ) : (
                  activeThread.messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "max-w-[85%] animate-in fade-in-0 slide-in-from-bottom-2 rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-sm duration-200",
                        message.role === "user"
                          ? "ml-auto border border-primary/25 bg-primary text-primary-foreground"
                          : "border border-border bg-surface-2 text-foreground",
                      )}
                    >
                      <div className="whitespace-pre-wrap">{message.content}</div>
                      <div
                        className={cn(
                          "mt-2 text-[10px]",
                          message.role === "user"
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground",
                        )}
                      >
                        {new Date(message.createdAt).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="border-t border-border p-3 sm:p-4">
                <div className="rounded-3xl border border-border bg-surface-2/70 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.12)] animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Например: добавь задачу для CEO по запуску новой фичи..."
                    className="min-h-[92px] resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5" />
                      Задачи создаются сразу после отправки
                    </div>
                    <Button
                      onClick={() => void handleSend()}
                      disabled={isSending || !draft.trim()}
                      className="rounded-full"
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Отправить
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
