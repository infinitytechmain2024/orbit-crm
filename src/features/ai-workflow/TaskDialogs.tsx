import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Link2,
  Loader2,
  Mic,
  Paperclip,
  Radio,
  Sparkles,
  Square,
} from "lucide-react";
import { z } from "zod";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  NewWorkflowTask,
  WorkflowAgent,
  WorkflowDepartment,
  WorkflowPriority,
  WorkflowProject,
  WorkflowTask,
} from "./types";

const newTaskSchema = z.object({
  title: z.string().trim().min(2, "Введите название задачи").max(240),
  description: z.string().trim().max(12000),
  projectId: z.string().uuid("Выберите проект"),
  priority: z.enum(["low", "medium", "high", "critical"]),
});

const fieldClass =
  "w-full rounded-xl border border-border bg-[#0a1722] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/10";

export function CreateTaskDialog({
  open,
  projects,
  departments,
  agents,
  initialProjectId,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  projects: WorkflowProject[];
  departments: WorkflowDepartment[];
  agents: WorkflowAgent[];
  initialProjectId: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: Omit<NewWorkflowTask, "organization_id">) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<WorkflowPriority>("medium");
  const [dueAt, setDueAt] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [autoAssign, setAutoAssign] = useState(true);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [links, setLinks] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProjectId(initialProjectId || projects[0]?.id || "");
    setError(null);
  }, [initialProjectId, open, projects]);

  const availableAgents = useMemo(
    () =>
      agents.filter(
        (agent) => agent.role !== "CEO" && (!departmentId || agent.department_id === departmentId),
      ),
    [agents, departmentId],
  );

  async function submit() {
    const parsed = newTaskSchema.safeParse({ title, description, projectId, priority });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте поля задачи");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        project_id: projectId,
        title: parsed.data.title,
        description: parsed.data.description,
        priority,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        attachments,
        links: links
          .split(/\n|,/)
          .map((item) => item.trim())
          .filter(Boolean),
        department_id: departmentId || null,
        agent_id: agentId || null,
        auto_assign: autoAssign,
        requires_approval: requiresApproval,
      });
      setTitle("");
      setDescription("");
      setDueAt("");
      setLinks("");
      setAttachments([]);
      setDepartmentId("");
      setAgentId("");
      setAutoAssign(true);
      setRequiresApproval(false);
      onOpenChange(false);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Не удалось создать задачу");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto border-border bg-[#0b1823] p-0 shadow-[0_28px_90px_rgba(0,0,0,.55)]">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </span>
            Новая задача AI-команде
          </DialogTitle>
          <DialogDescription>
            Опишите результат — AI Router подберёт отдел, агента и модель.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Название задачи</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={fieldClass}
              placeholder="Например, подготовить SEO-стратегию"
            />
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Подробное описание</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={`${fieldClass} min-h-28 resize-y`}
              placeholder="Контекст, ограничения и ожидаемый результат…"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Проект</span>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className={fieldClass}
            >
              <option value="">Выберите проект</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Приоритет</span>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as WorkflowPriority)}
              className={fieldClass}
            >
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
              <option value="critical">Критичный</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Срок выполнения</span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Отдел (необязательно)</span>
            <select
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setAgentId("");
              }}
              className={fieldClass}
            >
              <option value="">AI выберет отдел</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Агент (необязательно)</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className={fieldClass}
            >
              <option value="">AI выберет агента</option>
              {availableAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.role}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Link2 className="size-3.5" /> Ссылки
            </span>
            <textarea
              value={links}
              onChange={(event) => setLinks(event.target.value)}
              className={`${fieldClass} min-h-20 resize-none`}
              placeholder="По одной ссылке на строку"
            />
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Paperclip className="size-3.5" /> Вложения
            </span>
            <input
              type="file"
              multiple
              onChange={(event) =>
                setAttachments(Array.from(event.target.files ?? []).map((file) => file.name))
              }
              className={`${fieldClass} file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:text-primary`}
            />
            {attachments.length > 0 && (
              <p className="text-[11px] text-muted-foreground">{attachments.join(" · ")}</p>
            )}
          </label>

          <div className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setAutoAssign((value) => !value)}
              className="flex items-center justify-between rounded-xl border border-border bg-white/[0.025] px-3 py-3 text-left"
            >
              <span>
                <span className="block text-xs font-medium">AI определит исполнителя</span>
                <span className="text-[11px] text-muted-foreground">Включено по умолчанию</span>
              </span>
              <span
                className={`relative h-5 w-9 rounded-full transition ${autoAssign ? "bg-primary" : "bg-surface-2"}`}
              >
                <span
                  className={`absolute top-0.5 size-4 rounded-full bg-white transition ${autoAssign ? "left-[18px]" : "left-0.5"}`}
                />
              </span>
            </button>
            <button
              type="button"
              onClick={() => setRequiresApproval((value) => !value)}
              className="flex items-center justify-between rounded-xl border border-border bg-white/[0.025] px-3 py-3 text-left"
            >
              <span>
                <span className="block text-xs font-medium">Требуется CEO</span>
                <span className="text-[11px] text-muted-foreground">
                  Для стратегических решений
                </span>
              </span>
              <span
                className={`relative h-5 w-9 rounded-full transition ${requiresApproval ? "bg-amber-400" : "bg-surface-2"}`}
              >
                <span
                  className={`absolute top-0.5 size-4 rounded-full bg-white transition ${requiresApproval ? "left-[18px]" : "left-0.5"}`}
                />
              </span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-2 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}
        <DialogFooter className="border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-xl border border-border px-4 text-xs text-muted-foreground transition hover:text-foreground"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void submit()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Создать и назначить
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VoiceTaskDialog({
  open,
  projects,
  initialProjectId,
  onOpenChange,
  onTranscribe,
  onCreate,
  onManualFallback,
}: {
  open: boolean;
  projects: WorkflowProject[];
  initialProjectId: string;
  onOpenChange: (open: boolean) => void;
  onTranscribe: (audio: Blob) => Promise<string>;
  onCreate: (projectId: string, transcript: string) => Promise<void>;
  onManualFallback: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing" | "ready">("idle");
  const [transcript, setTranscript] = useState("");
  const [projectId, setProjectId] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setCreating] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (open) setProjectId(initialProjectId || projects[0]?.id || "");
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [initialProjectId, open, projects]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Этот браузер не поддерживает запись. Создайте задачу вручную.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(
        stream,
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? { mimeType: "audio/webm;codecs=opus" }
          : undefined,
      );
      recorderRef.current = recorder;
      chunksRef.current = [];
      setElapsed(0);
      setError(null);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setPhase("transcribing");
        try {
          const text = await onTranscribe(
            new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }),
          );
          setTranscript(text);
          setPhase("ready");
        } catch (unknownError) {
          setError(
            unknownError instanceof Error ? unknownError.message : "Сервис транскрипции недоступен",
          );
          setPhase("idle");
        }
      };
      recorder.start(500);
      setPhase("recording");
    } catch {
      setError("Нет доступа к микрофону. Разрешите запись в браузере или создайте задачу вручную.");
    }
  }

  async function confirm() {
    if (!projectId || transcript.trim().length < 2) {
      setError("Выберите проект и проверьте текст задачи.");
      return;
    }
    setCreating(true);
    try {
      await onCreate(projectId, transcript.trim());
      setTranscript("");
      setPhase("idle");
      onOpenChange(false);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Не удалось создать задачу");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-[#0b1823]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-5 text-primary" /> Голосовая задача
          </DialogTitle>
          <DialogDescription>
            Запишите поручение, проверьте транскрипцию и отправьте AI-команде.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid place-items-center rounded-2xl border border-border bg-[#07131d] px-4 py-7 text-center">
            {phase === "transcribing" ? (
              <>
                <Loader2 className="mb-3 size-10 animate-spin text-primary" />
                <p className="text-sm font-medium">Расшифровываю запись…</p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={
                    phase === "recording"
                      ? () => recorderRef.current?.stop()
                      : () => void startRecording()
                  }
                  className={`grid size-16 place-items-center rounded-full border transition ${phase === "recording" ? "border-red-400/50 bg-red-400/15 text-red-300 shadow-[0_0_30px_rgba(248,113,113,.2)]" : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"}`}
                  aria-label={phase === "recording" ? "Остановить запись" : "Начать запись"}
                >
                  {phase === "recording" ? (
                    <Square className="size-6 fill-current" />
                  ) : (
                    <Mic className="size-7" />
                  )}
                </button>
                <p className="mt-3 text-sm font-medium">
                  {phase === "recording"
                    ? `Идёт запись · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`
                    : transcript
                      ? "Можно записать заново"
                      : "Нажмите, чтобы начать"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Микрофон используется только после разрешения браузера.
                </p>
              </>
            )}
          </div>
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Проект</span>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className={fieldClass}
            >
              <option value="">Выберите проект</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Текст задачи</span>
            <textarea
              value={transcript}
              onChange={(event) => {
                setTranscript(event.target.value);
                setPhase("ready");
              }}
              className={`${fieldClass} min-h-28 resize-y`}
              placeholder="После записи здесь появится текст. Его можно отредактировать вручную."
            />
          </label>
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onManualFallback}
            className="h-10 rounded-xl border border-border px-4 text-xs text-muted-foreground hover:text-foreground"
          >
            Создать вручную
          </button>
          <button
            type="button"
            disabled={isCreating || !transcript.trim()}
            onClick={() => void confirm()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {isCreating && <Loader2 className="size-4 animate-spin" />} Подтвердить задачу
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RejectTaskDialog({
  task,
  onClose,
  onReject,
}: {
  task: WorkflowTask | null;
  onClose: () => void;
  onReject: (comment: string, decision: "request_changes" | "reject") => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="border-border bg-[#0b1823]">
        <DialogHeader>
          <DialogTitle>Решение по критическому действию</DialogTitle>
          <DialogDescription>{task?.title}</DialogDescription>
        </DialogHeader>
        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Комментарий владельца</span>
          <textarea
            autoFocus
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className={`${fieldClass} min-h-28`}
            placeholder="Что нужно исправить или уточнить?"
          />
        </label>
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-border px-4 text-xs"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={comment.trim().length < 3 || isSubmitting}
            onClick={() => {
              setSubmitting(true);
              void onReject(comment.trim(), "request_changes").finally(() => {
                setSubmitting(false);
                setComment("");
              });
            }}
            className="h-10 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 text-xs font-semibold text-amber-200 disabled:opacity-50"
          >
            Запросить изменения
          </button>
          <button
            type="button"
            disabled={comment.trim().length < 3 || isSubmitting}
            onClick={() => {
              setSubmitting(true);
              void onReject(comment.trim(), "reject").finally(() => {
                setSubmitting(false);
                setComment("");
              });
            }}
            className="h-10 rounded-xl border border-red-400/40 bg-red-400/10 px-4 text-xs font-semibold text-red-300 disabled:opacity-50"
          >
            Отклонить действие
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
