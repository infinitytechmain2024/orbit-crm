import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronRight, MessageSquarePlus, Send, Sparkles, Trash2 } from "lucide-react";

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
          className="h-9 gap-2 rounded-full border-border bg-surface-2/70 text-xs"
        >
          <MessageSquarePlus className="h-4 w-4" />
          Чаты
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="h-[100dvh] w-[100vw] max-w-none border-border bg-background p-0 sm:w-[min(98vw,72rem)] lg:w-[min(98vw,88rem)]"
      >
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Скрытый AI чат
            </SheetTitle>
            <SheetDescription>
              Диалоги живут только в AI Workflow и создают задачи в фоне.
            </SheetDescription>
          </SheetHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[16rem_1fr]">
            <aside className="border-b border-border p-3 md:border-b-0 md:border-r">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  История
                </span>
                <button
                  type="button"
                  onClick={createThread}
                  className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
                >
                  Новый
                </button>
              </div>
              <div className="space-y-2 overflow-y-auto">
                {threads.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Пока нет чатов. Создайте первый скрытый диалог.
                  </div>
                ) : (
                  threads.map((thread) => {
                    const active = thread.id === activeThreadId;
                    return (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => setActiveThreadId(thread.id)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition",
                          active
                            ? "border-primary/40 bg-primary/10"
                            : "border-border bg-surface-2/40 hover:bg-surface-2/70",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{thread.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {thread.messages.length} сообщений
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
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

            <section className="flex min-h-0 flex-col">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {!activeThread ? (
                  <div className="grid h-full place-items-center rounded-3xl border border-dashed border-border text-sm text-muted-foreground">
                    Выберите чат слева или создайте новый.
                  </div>
                ) : (
                  activeThread.messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-relaxed",
                        message.role === "user"
                          ? "ml-auto bg-primary text-primary-foreground"
                          : "bg-surface-2 text-foreground",
                      )}
                    >
                      {message.content}
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-border p-4">
                <div className="rounded-3xl border border-border bg-surface-2/70 p-3">
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Например: добавь задачу для CEO по запуску новой фичи..."
                    className="min-h-[92px] resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5" />
                      Задачи создаются сразу после отправки
                    </div>
                    <Button onClick={() => void handleSend()} disabled={isSending || !draft.trim()}>
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
