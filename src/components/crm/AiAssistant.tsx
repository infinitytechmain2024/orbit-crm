import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { useCrm } from "@/lib/crm-store";
import { cn } from "@/lib/utils";

type Msg = { id: string; role: "user" | "ai"; text: string };

const suggestions = ["Создай задачу", "Покажи аналитику", "Что горит сегодня?"];

export function AiAssistant() {
  const { addTask, tasks, txs } = useCrm();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: "m0",
      role: "ai",
      text: "Привет! Я ассистент Orbit. Могу собрать задачу из мысли, показать сводку по деньгам или подсказать, что важно сегодня.",
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, thinking, open]);

  const reply = async (q: string) => {
    const lower = q.toLowerCase();
    if (lower.includes("задач") && (lower.includes("созда") || lower.includes("добав"))) {
      const title = q.replace(/созда(й|ть)\s*задач[уy]?:?/i, "").trim() || "Новая задача из ИИ-чата";
      const task = await addTask({ title, status: "todo", priority: "high", tags: ["ии"] });
      return task
        ? `Готово — создал задачу «${title}» в колонке «К работе» с высоким приоритетом.`
        : "Не смог сохранить задачу. Проверьте сообщение об ошибке внизу экрана.";
    }
    if (lower.includes("аналитик") || lower.includes("деньг") || lower.includes("финанс")) {
      const inc = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
      const exp = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
      return `За август: доход ${inc.toLocaleString("ru-RU")} €, расход ${exp.toLocaleString("ru-RU")} €, чистыми ${(inc - exp).toLocaleString("ru-RU")} €. Маржинальность ~${Math.round(((inc - exp) / inc) * 100)}%.`;
    }
    if (lower.includes("горит") || lower.includes("сегодня") || lower.includes("важн")) {
      const hot = tasks.filter((t) => t.priority === "high" && t.status !== "done").slice(0, 3);
      return hot.length
        ? `Приоритет на сегодня:\n${hot.map((t, i) => `${i + 1}. ${t.title}`).join("\n")}`
        : "Всё под контролем — срочных задач нет.";
    }
    return "Записал в единую память. Могу разложить это на задачи, связать с проектом или найти похожие письма — скажи, что сделать.";
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || thinking) return;
    setMsgs((m) => [...m, { id: Math.random().toString(36), role: "user", text: q }]);
    setInput("");
    setThinking(true);
    const [answer] = await Promise.all([
      reply(q),
      new Promise((resolve) => window.setTimeout(resolve, 1100)),
    ]);
    setMsgs((m) => [...m, { id: Math.random().toString(36), role: "ai", text: answer }]);
    setThinking(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="ИИ-ассистент"
        className={cn(
          "fixed bottom-6 right-6 z-40 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-acc-1 to-acc-2 text-primary-foreground shadow-[0_20px_50px_-20px_var(--acc-1)] transition hover:scale-105",
          !open && "floaty",
        )}
      >
        {open ? <X className="size-5" /> : <Bot className="size-6" />}
      </button>

      <div
        className={cn(
          "fixed bottom-24 right-6 z-40 flex w-[calc(100vw-3rem)] max-w-sm flex-col overflow-hidden rounded-2xl glass shadow-2xl transition-all duration-300",
          open
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="size-4 text-primary" />
          <p className="text-sm font-semibold">ИИ-ассистент</p>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" /> онлайн
          </span>
        </div>

        <div className="max-h-80 space-y-3 overflow-y-auto p-4">
          {msgs.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-sm",
                m.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-surface-2 text-foreground",
              )}
            >
              {m.text}
            </div>
          ))}
          {thinking && (
            <div className="flex w-20 items-center gap-1 rounded-xl bg-surface-2 px-3 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-bounce rounded-full bg-primary"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => void send(s)}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-primary"
            >
              {s}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-center gap-2 border-t border-border p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Спросите что-нибудь…"
            className="flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground transition hover:opacity-90"
          >
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </>
  );
}
