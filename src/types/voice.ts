export type VoiceRecorderState =
  "idle" | "recording" | "processing" | "preview" | "executing" | "done" | "error";

export type VoiceIntentType = "CREATE_TASK" | "ESTIMATE_PROJECT" | "WEB_SEARCH_LEADS" | "UNKNOWN";

export interface VoiceIntent {
  type: VoiceIntentType;
  entities: {
    projectName?: string;
    taskTitle?: string;
    projectDescription?: string;
    companyName?: string;
    city?: string;
    niche?: string;
    count?: number;
    websiteStatus?: string;
  };
  rawText: string;
  confidence: number;
}

export interface VoiceProcessResult {
  transcript: string;
  intent: VoiceIntent;
  suggestedActions: string[];
}

export interface IntentExecutionResult {
  success: boolean;
  action: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  language?: string;
  duration?: number;
}

export interface VoiceRecorderProps {
  onResult?: (result: VoiceProcessResult) => void;
  onError?: (error: string) => void;
  className?: string;
  onTaskCreated?: (taskId: string) => void;
}
