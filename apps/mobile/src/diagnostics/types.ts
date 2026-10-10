export interface DiagnosticSample {
  timestamp: number;
  accuracy: number | null;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
}

export type CueDeliveryStatus = "attempted" | "completed" | "failed" | "skipped";

export interface SpokenCueLogEntry {
  id: string;
  instruction: string;
  timestamp: number;
  status: CueDeliveryStatus;
  errorMessage?: string | undefined;
}

export type DiagnosticSessionStatus =
  | "idle"
  | "running"
  | "stopping"
  | "stopped"
  | "interrupted"
  | "error";

export interface DiagnosticSession {
  sessionId: string;
  version?: number | undefined;
  status: DiagnosticSessionStatus;
  startedAt: number;
  stoppedAt?: number | undefined;
  interruptedAt?: number | undefined;
  sampleCount: number;
  minIntervalMs?: number | undefined;
  maxIntervalMs?: number | undefined;
  totalIntervalMs?: number | undefined;
  intervalCount?: number | undefined;
  lastSampleTimestamp?: number | undefined;
  lastSampleAccuracy?: number | undefined;
  spokenCueIds: string[];
  lastSpokenCue?: string | undefined;
  lastSpokenAt?: number | undefined;
  cuesLog: SpokenCueLogEntry[];
  errorMessage?: string | undefined;
}

export interface DiagnosticSummary {
  sessionId?: string | undefined;
  status: DiagnosticSessionStatus;
  startedAt: number;
  stoppedAt?: number | undefined;
  interruptedAt?: number | undefined;
  elapsedSeconds: number;
  sampleCount: number;
  minIntervalMs?: number | undefined;
  maxIntervalMs?: number | undefined;
  avgIntervalMs?: number | undefined;
  lastSampleAccuracy?: number | undefined;
  spokenCueCount: number;
  completedCueCount: number;
  totalScheduledCues: number;
  lastSpokenCue?: string | undefined;
  cuesLog: SpokenCueLogEntry[];
  errorMessage?: string | undefined;
}

export interface DiagnosticCue {
  id: string;
  triggerElapsedSeconds: number;
  instruction: string;
}
