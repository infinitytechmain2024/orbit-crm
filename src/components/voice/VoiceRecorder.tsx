import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { transcribeAudio } from "@/agents/whisper";

type VoiceRecorderState = "idle" | "recording" | "processing" | "preview" | "error";

interface VoiceRecorderProps {
  onTranscript?: (transcript: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

export function VoiceRecorder({ onTranscript, onError, className }: VoiceRecorderProps) {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
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
    setRecordingTime(0);
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
        cleanup();

        try {
          const result = await transcribeAudio(audioBlob);
          setTranscript(result.text);
          setState("preview");
          onTranscript?.(result.text);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Transcription failed";
          onError?.(errorMsg);
          setState("error");
        }
      };

      mediaRecorder.start(100);
      setState("recording");
      setTranscript("");

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Could not start recording";
      onError?.(errorMsg);
      setState("error");
      cleanup();
    }
  }, [onError, onTranscript, cleanup, updateAudioLevel]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, [state]);

  const reset = useCallback(() => {
    setState("idle");
    setTranscript("");
    setRecordingTime(0);
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
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
          {state === "idle" && <Mic className="size-6" />}
          {state === "preview" && <CheckCircle className="size-6" />}
          {state === "error" && <XCircle className="size-6" />}
        </button>

        {state === "recording" && (
          <>
            <div className="absolute inset-0 rounded-full border-2 border-red-500/50 animate-ping" />
            <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-red-400 font-mono">
              {formatTime(recordingTime)}
            </div>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-3">
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
          </>
        )}
      </div>

      {state === "processing" && (
        <p className="text-xs text-muted-foreground animate-pulse">Processing...</p>
      )}

      {state === "preview" && transcript && (
        <div className="w-full max-w-sm space-y-2 rounded-xl border border-green-500/30 bg-green-500/5 p-3 animate-in fade-in slide-in-from-bottom-2">
          <p className="text-xs text-muted-foreground">
            Transcript: <span className="text-foreground font-medium">"{transcript}"</span>
          </p>
          <p className="text-xs text-muted-foreground/60">
            Edit the search bar above and click "Find Leads"
          </p>
          <button
            onClick={reset}
            className="w-full rounded-lg border border-border py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Record Again
          </button>
        </div>
      )}

      {state === "error" && (
        <div className="space-y-2 animate-in fade-in">
          <p className="text-xs text-destructive">Recording failed. Try again.</p>
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
