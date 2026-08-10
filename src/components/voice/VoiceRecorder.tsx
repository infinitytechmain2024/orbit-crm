import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { transcribeAudio } from "@/agents/whisper";

type VoiceState = "idle" | "recording" | "processing" | "preview" | "error";

interface VoiceRecorderProps {
  onTranscript?: (transcript: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

export function VoiceRecorder({ onTranscript, onError, className }: VoiceRecorderProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const [micBlocked, setMicBlocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cleanup ──────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setAudioLevel(0);
    setRecordingTime(0);
  }, []);

  // ── Audio level visualizer ───────────────────────────────────────────
  const updateLevel = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(data);
    const avg = data.reduce((s, v) => s + v, 0) / data.length;
    setAudioLevel(Math.min(avg / 128, 1));
    animFrameRef.current = requestAnimationFrame(updateLevel);
  }, []);

  // ── Check microphone permission ──────────────────────────────────────
  const checkMicPermission = useCallback(async (): Promise<boolean> => {
    try {
      // Try a quick probe — if denied, this throws
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      setMicBlocked(false);
      return true;
    } catch {
      setMicBlocked(true);
      return false;
    }
  }, []);

  // ── Start recording ──────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setErrorMsg("");

    // 1) Check / request mic
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setMicBlocked(true);
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Allow it in browser settings."
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "No microphone found."
            : `Microphone error: ${err instanceof Error ? err.message : err}`;
      setErrorMsg(msg);
      onError?.(msg);
      setState("error");
      return;
    }

    streamRef.current = stream;

    // 2) Audio context + analyser
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    ctx.createMediaStreamSource(stream).connect(analyser);
    updateLevel();

    // 3) MediaRecorder
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      setState("processing");
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      cleanup();

      try {
        const result = await transcribeAudio(blob);
        setTranscript(result.text);
        setState("preview");
        onTranscript?.(result.text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Transcription failed";
        setErrorMsg(msg);
        onError?.(msg);
        setState("error");
      }
    };

    recorder.start(100);
    setState("recording");
    setTranscript("");

    timerRef.current = setInterval(() => {
      setRecordingTime((t) => t + 1);
    }, 1000);
  }, [cleanup, onError, onTranscript, updateLevel]);

  // ── Stop recording ───────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // ── Reset ────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    cleanup();
    setState("idle");
    setTranscript("");
    setErrorMsg("");
    setMicBlocked(false);
  }, [cleanup]);

  // ── Init: probe mic on mount ─────────────────────────────────────────
  useEffect(() => {
    checkMicPermission();
    return () => cleanup();
  }, [checkMicPermission, cleanup]);

  // ── Helpers ──────────────────────────────────────────────────────────
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      {/* ── Main button ── */}
      <div className="relative">
        <button
          onClick={state === "recording" ? stopRecording : startRecording}
          disabled={state === "processing"}
          className={cn(
            "relative grid size-16 place-items-center rounded-full transition-all duration-300",
            state === "recording"
              ? "bg-red-500/20 text-red-400 ring-2 ring-red-500/50"
              : state === "processing"
                ? "bg-primary/20 text-primary"
                : state === "preview"
                  ? "bg-green-500/20 text-green-500"
                  : state === "error"
                    ? "bg-destructive/20 text-destructive"
                    : "bg-surface-2 hover:bg-surface-3 text-muted-foreground",
            state === "recording" && "animate-pulse",
          )}
          aria-label={state === "recording" ? "Stop recording" : "Start recording"}
        >
          {state === "processing" && <Loader2 className="size-6 animate-spin" />}
          {state === "recording" && <Square className="size-5" />}
          {(state === "idle" || state === "error" || micBlocked) && <Mic className="size-6" />}
          {state === "preview" && <CheckCircle className="size-6" />}
        </button>

        {/* Ping ring while recording */}
        {state === "recording" && (
          <div className="absolute inset-0 rounded-full border-2 border-red-500/50 animate-ping" />
        )}

        {/* Timer */}
        {state === "recording" && (
          <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-red-400 font-mono">
            {formatTime(recordingTime)}
          </span>
        )}

        {/* Wave bars */}
        {state === "recording" && (
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2">
            <div className="flex gap-0.5 h-3 items-end">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-red-400 transition-all duration-75"
                  style={{
                    height: `${Math.max(3, audioLevel * 24 + Math.sin(Date.now() / 200 + i) * 4)}px`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── State labels ── */}
      {state === "idle" && !micBlocked && (
        <p className="text-xs text-muted-foreground">🎙 Tap to record</p>
      )}

      {state === "processing" && (
        <p className="text-xs text-muted-foreground animate-pulse">⏳ Transcribing...</p>
      )}

      {/* ── Mic blocked warning ── */}
      {micBlocked && state !== "recording" && (
        <div className="flex flex-col items-center gap-2 animate-in fade-in">
          <p className="text-xs text-amber-500 text-center max-w-[200px]">
            {errorMsg || "Microphone access blocked. Allow mic in browser settings."}
          </p>
          <button
            onClick={async () => {
              const ok = await checkMicPermission();
              if (ok) setErrorMsg("");
            }}
            className="flex items-center gap-1 rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs text-amber-500 hover:bg-amber-500/10"
          >
            <RefreshCw className="size-3" /> Retry
          </button>
        </div>
      )}

      {/* ── Preview (transcript) ── */}
      {state === "preview" && transcript && (
        <div className="w-full max-w-sm space-y-2 rounded-xl border border-green-500/30 bg-green-500/5 p-3 animate-in fade-in slide-in-from-bottom-2">
          <p className="text-xs text-muted-foreground">
            Transcript: <span className="text-foreground font-medium">&quot;{transcript}&quot;</span>
          </p>
          <p className="text-xs text-muted-foreground/60">
            Edit the search bar above and click &quot;Find Leads&quot;
          </p>
          <button
            onClick={reset}
            className="w-full rounded-lg border border-border py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Record Again
          </button>
        </div>
      )}

      {/* ── Error ── */}
      {state === "error" && !micBlocked && (
        <div className="space-y-2 animate-in fade-in">
          <p className="text-xs text-destructive text-center max-w-[220px]">
            {errorMsg || "Recording failed. Try again."}
          </p>
          <button
            onClick={reset}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-3" /> Retry
          </button>
        </div>
      )}
    </div>
  );
}
