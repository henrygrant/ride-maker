export interface SpeechOptions {
  language?: string;
  pitch?: number;
  rate?: number;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

export interface SpeechAdapter {
  speak(text: string, options?: SpeechOptions): Promise<void>;
  stop(): Promise<void>;
  isSpeakingAsync(): Promise<boolean>;
}
