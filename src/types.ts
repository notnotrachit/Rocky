export type PetAnimation = "idle" | "talk" | "think" | "inspect" | "celebrate" | "confused" | "sleep" | "wake";

export type PetMood = "calm" | "curious" | "focused" | "excited" | "confused" | "sleepy";

export type PetAction = {
  mood: PetMood;
  animation: PetAnimation;
  speech: string;
  durationMs: number;
};

export type Provider = "ollama" | "openai" | "anthropic" | "google";

export type ControlTab = "chat" | "behavior" | "voice" | "memory" | "privacy" | "debug";

export type OllamaHealth = {
  ready: boolean;
};

export type ActiveApp = {
  name: string;
  bundleIdentifier?: string;
  processId: number;
};

export type AccessibilityObservation = {
  trusted: boolean;
  activeApp: ActiveApp | null;
  windowTitle: string | null;
  focusedRole: string | null;
  focusedTitle: string | null;
  focusedValue: string | null;
  selectedText: string | null;
};

export type OllamaModel = {
  name: string;
  modifiedAt?: string;
  size?: number;
};

export type PlanResult = {
  action: PetAction;
  memoriesUsed: MemoryItem[];
  memoriesSaved: MemoryItem[];
};

export type ObservePlanResult = {
  observation: AccessibilityObservation;
  sanitizedContext: string;
  reactionKey: string | null;
  action: PetAction | null;
  skippedReason: string | null;
};

export type ControlSettings = {
  provider: Provider;
  model: string;
  baseUrl: string;
  apiKey: string;
  observationEnabled: boolean;
  quietMode: boolean;
  launchAtLogin: boolean;
  memoryEnabled: boolean;
};

export type MemoryItem = {
  id: string;
  subject: string;
  fact: string;
  source: string;
  confidence: number;
  createdAt: number;
  lastUsedAt: number;
};

export type VoiceSettings = {
  selectedModel: string;
  pushToTalkShortcut: string;
  useLocalStt: boolean;
};

export type VoiceModelInfo = {
  id: string;
  name: string;
  description: string;
  engine: string;
  filename: string;
  url: string;
  sizeMb: number;
  isRecommended: boolean;
  isDownloaded: boolean;
  localPath: string | null;
};

export type VoiceDownloadProgress = {
  modelId: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  done: boolean;
};

export type RuntimeStatus = {
  state: "idle" | "thinking" | "ready" | "offline" | "error";
  lastLatencyMs: number | null;
  lastError: string | null;
};

export const idleAction: PetAction = {
  mood: "curious",
  animation: "idle",
  speech: "I observe. Quiet rock mode.",
  durationMs: 12000,
};

export const defaultSettings: ControlSettings = {
  provider: "ollama",
  model: "llama3.2",
  baseUrl: "http://127.0.0.1:11434",
  apiKey: "",
  observationEnabled: false,
  quietMode: false,
  launchAtLogin: false,
  memoryEnabled: true,
};

export const defaultVoiceSettings: VoiceSettings = {
  selectedModel: "parakeet-tdt-0.6b-v3",
  pushToTalkShortcut: "Option+Space",
  useLocalStt: true,
};
