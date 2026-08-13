import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { transcribeAudio } from "@/agents/whisper";

type RecorderState = "idle" | "requesting" | "recording" | "processing";

const AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
];

function getSupportedAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return AUDIO_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function getMicrophoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Нет доступа к микрофону. Разрешите его в настройках браузера.";
    }
    if (error.name === "NotFoundError") return "Микрофон не найден.";
    if (error.name === "NotSupportedError") {
      return "Браузер не поддерживает запись аудио в доступном формате.";
    }
  }
  return error instanceof Error ? error.message : "Не удалось начать запись.";
}

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
      const mediaRecorder = mediaRecorderRef.current;
      if (mediaRecorder?.state === "recording") {
        console.log("[QuickInput] stopping recording", {
          mimeType: mediaRecorder.mimeType,
          chunks: audioChunksRef.current.length,
        });
        mediaRecorder.stop();
      }
      return;
    }

    if (recorderState !== "idle") return;

    setRecorderState("requesting");
    setVoiceError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Этот браузер не поддерживает запись с микрофона.");
      }

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

      const supportedMimeType = getSupportedAudioMimeType();
      const mediaRecorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream);
      const recordedMimeType = mediaRecorder.mimeType || supportedMimeType || "audio/webm";
      let recorderFailed = false;
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onerror = (event) => {
        recorderFailed = true;
        console.error("[QuickInput] MediaRecorder error", event.error);
        setVoiceError(`Ошибка записи: ${event.error.message}`);
      };

      mediaRecorder.onstop = async () => {
        setRecorderState("processing");
        setVoiceError(null);
        const audioChunks = [...audioChunksRef.current];
        const audioBlob = new Blob(audioChunks, { type: recordedMimeType });
        console.log("[QuickInput] recording stopped", {
          chunks: audioChunks.length,
          blobSize: audioBlob.size,
          blobType: audioBlob.type,
        });
        cleanup();

        try {
          if (recorderFailed) throw new Error("Браузер завершил запись с ошибкой.");
          if (audioBlob.size === 0) {
            throw new Error("Запись получилась пустой. Попробуйте говорить чуть дольше.");
          }

          console.log("[QuickInput] sending audio to Whisper", {
            size: audioBlob.size,
            type: audioBlob.type,
          });
          const result = await transcribeAudio(audioBlob);
          const transcript = result.text.trim();
          if (!transcript) throw new Error("Whisper не обнаружил речь в записи.");

          console.log("[QuickInput] updating textarea state", {
            transcript,
            language: result.language,
          });
          const trimmed = value.trim();
          const newPart = transcript.trim();
          if (!newPart) return;
          onChange(trimmed ? `${trimmed}\n${newPart}` : newPart);
        } catch (err) {
          console.error("[QuickInput] voice transcription failed:", err);
          setVoiceError(
            err instanceof Error ? err.message : "Не удалось распознать голос. Попробуйте ещё раз.",
          );
        } finally {
          setRecorderState("idle");
        }
      };

      mediaRecorder.start(100);
      console.log("[QuickInput] recording started", {
        mimeType: recordedMimeType,
        audioTracks: stream.getAudioTracks().length,
      });
      setRecorderState("recording");
    } catch (err) {
      console.error("[QuickInput] could not start microphone recording:", err);
      setVoiceError(getMicrophoneError(err));
      setRecorderState("idle");
      cleanup();
    }
  }, [recorderState, cleanup, updateAudioLevel, onChange, value]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const isRecording = recorderState === "recording";
  const isRequesting = recorderState === "requesting";
  const isProcessing = recorderState === "processing";

  return (
    <div className={cn("relative", className)}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled || isRequesting || isProcessing}
        className="w-full resize-none rounded-xl border border-border bg-surface-2/60 p-4 pr-12 text-sm outline-none transition focus:border-primary/60 disabled:opacity-60"
      />

      {/* Inline mic button */}
      <button
        type="button"
        onClick={() => void toggleRecording()}
        disabled={disabled || isRequesting || isProcessing}
        className={cn(
          "absolute right-3 top-3 grid size-8 place-items-center rounded-lg transition-all duration-200",
          isRecording
            ? "bg-red-500/20 text-red-500 animate-pulse"
            : isRequesting || isProcessing
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:bg-surface-3 hover:text-foreground",
          (disabled || isRequesting || isProcessing) && "opacity-50 cursor-not-allowed",
        )}
        aria-label={isRecording ? "Остановить запись" : "Голосовой ввод"}
      >
        {isRequesting || isProcessing ? (
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

      {/* Voice error feedback with retry button */}
      {voiceError && !isRecording && (
        <div className="mt-1 flex items-center gap-2" role="alert">
          <p className="text-[11px] text-destructive">{voiceError}</p>
          <button
            type="button"
            onClick={() => void toggleRecording()}
            className="text-[11px] text-primary underline underline-offset-2 hover:text-primary/80"
          >
            Повторить
          </button>
        </div>
      )}
    </div>
  );
}
