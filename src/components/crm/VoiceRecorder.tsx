import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2, CheckCircle, XCircle, Send, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { processVoiceNoteFn, executeIntentFn, aiLearnFn } from "@/lib/voice/server-functions";

type VoiceRecorderState =
  "idle" | "recording" | "processing" | "preview" | "executing" | "done" | "error";

interface VoiceIntent {
  type: "CREATE_TASK" | "ESTIMATE_PROJECT" | "WEB_SEARCH_LEADS" | "UNKNOWN";
  entities: {
    projectName?: string;
    taskTitle?: string;
    projectDescription?: string;
    companyName?: string;
  };
  rawText: string;
  confidence: number;
}

interface VoiceProcessResult {
  transcript: string;
  intent: VoiceIntent;
  suggestedActions: string[];
}

interface VoiceRecorderProps {
  onResult?: (result: VoiceProcessResult) => void;
  onError?: (error: string) => void;
  className?: string;
  onTaskCreated?: (taskId: string) => void;
}

export function VoiceRecorder({ onResult, onError, className, onTaskCreated }: VoiceRecorderProps) {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [result, setResult] = useState<VoiceProcessResult | null>(null);
  const [executionResult, setExecutionResult] = useState<{
    success: boolean;
    action: string;
    result?: Record<string, unknown>;
    error?: string;
  } | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackProjectId, setFeedbackProjectId] = useState<string>("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processAudioRef = useRef<((audioBlob: Blob) => Promise<void>) | null>(null);

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setAudioLevel(0);
  }, []);

  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    setAudioLevel(Math.min(average / 128, 1));

    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      updateAudioLevel();

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setState("processing");
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await processAudioRef.current?.(audioBlob);
        cleanup();
      };

      mediaRecorder.start(100);
      setState("recording");
      setResult(null);
      setExecutionResult(null);
      setShowFeedback(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Не удалось начать запись";
      onError?.(errorMsg);
      setState("error");
      cleanup();
    }
  }, [onError, cleanup, updateAudioLevel]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, [state]);

  const processAudio = useCallback(
    async (audioBlob: Blob) => {
      try {
        const formData = new FormData();
        formData.append("audio", audioBlob, "voice-note.webm");

        const response = await processVoiceNoteFn({
          request: new Request("", { method: "POST", body: formData }),
        });

        if (!response.ok) {
          throw new Error("Ошибка обработки аудио");
        }

        const data = await response.json();
        setResult(data);
        setState("preview");
        onResult?.(data);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Ошибка при обработке";
        onError?.(errorMsg);
        setState("error");
      }
    },
    [onResult, onError],
  );

  // Keep ref in sync
  processAudioRef.current = processAudio;

  const executeIntent = async () => {
    if (!result) return;

    setState("executing");
    try {
      const response = await executeIntentFn({
        request: new Request("", {
          method: "POST",
          body: JSON.stringify({ intent: result.intent }),
        }),
      });

      if (!response.ok) {
        throw new Error("Ошибка выполнения намерения");
      }

      const data = await response.json();
      setExecutionResult(data);
      setState("done");

      if (data.success && data.action === "CREATE_TASK" && data.result?.taskId) {
        onTaskCreated?.(data.result.taskId as string);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Ошибка при выполнении";
      onError?.(errorMsg);
      setExecutionResult({ success: false, action: result.intent.type, error: errorMsg });
      setState("done");
    }
  };

  const handleFeedback = async (correctedProjectId?: string) => {
    if (!result) return;

    const originalPhrase = result.intent.entities.projectName || "";
    const correctedValue = correctedProjectId
      ? { project_id: correctedProjectId }
      : { corrected: true };

    try {
      await aiLearnFn({
        request: new Request("", {
          method: "POST",
          body: JSON.stringify({ originalPhrase, correctedValue, entityType: "project" }),
        }),
      });
      setShowFeedback(false);
    } catch (err) {
      console.error("Feedback error:", err);
    }
  };

  const reset = useCallback(() => {
    setState("idle");
    setResult(null);
    setExecutionResult(null);
    setShowFeedback(false);
    setFeedbackProjectId("");
  }, []);

  const retry = useCallback(() => {
    setState("idle");
    setResult(null);
    setExecutionResult(null);
    setShowFeedback(false);
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const pulseAnimation = state === "recording";

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative">
        <button
          onClick={state === "recording" ? stopRecording : startRecording}
          disabled={state === "processing" || state === "executing"}
          className={cn(
            "relative grid size-16 place-items-center rounded-full transition-all duration-300",
            state === "recording"
              ? "bg-acc-4/20 text-acc-4 ring-2 ring-acc-4/50"
              : state === "processing" || state === "executing"
                ? "bg-primary/20 text-primary"
                : state === "preview"
                  ? "bg-yellow-500/20 text-yellow-500"
                  : state === "done"
                    ? "bg-green-500/20 text-green-500"
                    : state === "error"
                      ? "bg-destructive/20 text-destructive"
                      : "bg-surface-2 hover:bg-surface-3 text-muted-foreground",
            pulseAnimation && "animate-pulse",
          )}
          aria-label={state === "recording" ? "Остановить запись" : "Начать запись"}
        >
          {(state === "processing" || state === "executing") && (
            <Loader2 className="size-6 animate-spin" />
          )}
          {state === "recording" && <Mic className="size-6" />}
          {state === "idle" && <MicOff className="size-6" />}
          {state === "preview" && <Send className="size-6" />}
          {state === "done" && <CheckCircle className="size-6" />}
          {state === "error" && <XCircle className="size-6" />}
        </button>

        {state === "recording" && (
          <>
            <div
              className={cn(
                "absolute inset-0 rounded-full border-2 border-acc-4/50 animate-ping",
                pulseAnimation && "opacity-100",
              )}
            />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-2">
              <div className="flex gap-0.5 h-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      "w-1 rounded-full bg-acc-4 transition-all duration-100",
                      "animate-bounce",
                    )}
                    style={{
                      animationDelay: `${i * 80}ms`,
                      height: `${Math.max(4, audioLevel * 20 + Math.random() * 8)}px`,
                    }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {state === "preview" && result && (
        <div className="w-full max-w-xs text-center space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 animate-in fade-in slide-in-from-bottom-2">
          <p className="text-xs text-muted-foreground">
            Распознано: <span className="text-foreground">"{result.transcript}"</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Намерение: <span className="text-primary font-medium">{result.intent.type}</span>
          </p>
          {result.intent.entities.projectName && (
            <p className="text-xs text-muted-foreground">
              Проект: <span className="text-foreground">{result.intent.entities.projectName}</span>
            </p>
          )}
          {result.intent.entities.taskTitle && (
            <p className="text-xs text-muted-foreground">
              Задача: <span className="text-foreground">{result.intent.entities.taskTitle}</span>
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <button
              onClick={executeIntent}
              className="flex-1 rounded-lg bg-primary py-1.5 text-xs font-semibold text-primary-foreground"
            >
              Выполнить
            </button>
            <button
              onClick={reset}
              className="flex-1 rounded-lg border border-border py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {state === "done" && executionResult && (
        <div
          className="w-full max-w-xs space-y-2 rounded-xl border p-3 animate-in fade-in slide-in-from-bottom-2"
          style={{
            borderColor: executionResult.success
              ? "var(--success) / 0.3"
              : "var(--destructive) / 0.3",
            backgroundColor: executionResult.success
              ? "var(--success) / 0.05"
              : "var(--destructive) / 0.05",
          }}
        >
          {executionResult.success ? (
            <>
              <p className="text-sm font-medium text-success flex items-center justify-center gap-2">
                <CheckCircle className="size-4" />
                Готово: {executionResult.action.replace("_", " ")}
              </p>
              {executionResult.result && (
                <div className="text-xs text-muted-foreground space-y-1">
                  {executionResult.result.taskTitle && (
                    <p>
                      Задача:{" "}
                      <span className="text-foreground">{executionResult.result.taskTitle}</span>
                    </p>
                  )}
                  {executionResult.result.projectName && (
                    <p>
                      Проект:{" "}
                      <span className="text-foreground">{executionResult.result.projectName}</span>
                    </p>
                  )}
                  {executionResult.result.projectId && (
                    <p>
                      ID проекта:{" "}
                      <span className="text-foreground font-mono">
                        {executionResult.result.projectId}
                      </span>
                    </p>
                  )}
                </div>
              )}
              {executionResult.action === "CREATE_TASK" && result?.intent.entities.projectName && (
                <div className="pt-2 border-t border-border/50">
                  <p className="text-xs text-muted-foreground mb-2">
                    Проект верный? Если нет, выберите правильный:
                  </p>
                  <div className="flex gap-2">
                    <select
                      value={feedbackProjectId}
                      onChange={(e) => setFeedbackProjectId(e.target.value)}
                      className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs"
                    >
                      <option value="">— Выбрать проект —</option>
                    </select>
                    <button
                      onClick={() => handleFeedback(feedbackProjectId)}
                      disabled={!feedbackProjectId}
                      className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      Исправить
                    </button>
                  </div>
                </div>
              )}
              <button
                onClick={reset}
                className="w-full rounded-lg border border-border py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground mt-2"
              >
                Закрыть
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-destructive flex items-center justify-center gap-2">
                <XCircle className="size-4" />
                Ошибка: {executionResult.error}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={retry}
                  className="flex-1 rounded-lg bg-primary py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  <RefreshCw className="size-3 inline mr-1" /> Повторить
                </button>
                <button
                  onClick={reset}
                  className="flex-1 rounded-lg border border-border py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  Закрыть
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {state === "error" && (
        <div className="w-full max-w-xs text-center text-xs text-destructive animate-in fade-in">
          Ошибка записи. Попробуйте снова.
        </div>
      )}
    </div>
  );
}
