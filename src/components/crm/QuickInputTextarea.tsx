import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { transcribeAudio } from "@/agents/whisper";

type RecorderState = "idle" | "recording" | "processing";

interface QuickInputTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  disabled?: boolean;
}

export function QuickInputTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  className,
  disabled,
}: QuickInputTextareaProps) {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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

  const toggleRecording = useCallback(async () => {
    if (recorderState === "recording") {
      mediaRecorderRef.current?.stop();
      return;
    }

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
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        setRecorderState("processing");
        setVoiceError(null);
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        console.log("[QuickInput] recording stopped", {
          chunks: audioChunksRef.current.length,
          blobSize: audioBlob.size,
        });
        cleanup();

        try {
          const result = await transcribeAudio(audioBlob);
          if (result.text) {
            console.log("[QuickInput] transcript received, updating input:", result.text);
            onChange(result.text);
          } else {
            console.warn("[QuickInput] empty transcript — nothing to insert");
            setVoiceError("Не удалось распознать речь. Попробуйте ещё раз.");
          }
        } catch (err) {
          console.error("[QuickInput] voice transcription failed:", err);
          setVoiceError(err instanceof Error ? err.message : "Ошибка распознавания голоса");
        } finally {
          setRecorderState("idle");
        }
      };

      mediaRecorder.start(100);
      setVoiceError(null);
      setRecorderState("recording");
    } catch (err) {
      console.error("Microphone access denied:", err);
      setRecorderState("idle");
      cleanup();
    }
  }, [recorderState, cleanup, updateAudioLevel, onChange]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const isRecording = recorderState === "recording";
  const isProcessing = recorderState === "processing";

  return (
    <div className={cn("relative", className)}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled || isProcessing}
        className="w-full resize-none rounded-xl border border-border bg-surface-2/60 p-4 pr-12 text-sm outline-none transition focus:border-primary/60 disabled:opacity-60"
      />

      {/* Inline mic button */}
      <button
        type="button"
        onClick={() => void toggleRecording()}
        disabled={disabled || isProcessing}
        className={cn(
          "absolute right-3 top-3 grid size-8 place-items-center rounded-lg transition-all duration-200",
          isRecording
            ? "bg-red-500/20 text-red-500 animate-pulse"
            : isProcessing
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:bg-surface-3 hover:text-foreground",
          (disabled || isProcessing) && "opacity-50 cursor-not-allowed",
        )}
        aria-label={isRecording ? "Остановить запись" : "Голосовой ввод"}
      >
        {isProcessing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isRecording ? (
          <MicOff className="size-4" />
        ) : (
          <Mic className="size-4" />
        )}
      </button>

      {/* Inline recording indicator */}
      {isRecording && (
        <div className="absolute bottom-2 left-4 flex items-center gap-2">
          <div className="flex gap-0.5 h-3">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="w-0.5 rounded-full bg-red-500 transition-all duration-100"
                style={{
                  height: `${Math.max(3, audioLevel * 16 + Math.sin(Date.now() / 200 + i) * 4)}px`,
                  animationDelay: `${i * 60}ms`,
                }}
              />
            ))}
          </div>
          <span className="text-[10px] text-red-500 font-medium">запись</span>
        </div>
      )}

      {/* Voice error feedback — previously the failure was swallowed silently */}
      {voiceError && !isRecording && (
        <p className="absolute -bottom-5 left-0 right-0 text-[11px] text-destructive">
          {voiceError}
        </p>
      )}
    </div>
  );
}
