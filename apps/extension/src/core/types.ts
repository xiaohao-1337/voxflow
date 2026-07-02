export type LangCode = 'auto' | 'en' | 'zh' | 'ja' | 'ko' | 'fr' | 'de' | 'es';

export type LatencyMode = 'low-latency' | 'sync-first';

export interface Settings {
  enabled: boolean;
  localEngineUrl: string;
  localEngineToken: string;
  sourceLang: LangCode;
  targetLang: LangCode;
  asrProvider: 'funasr';
  mtProvider: 'argos' | 'libretranslate' | 'ctranslate2';
  ttsProvider: 'cosyvoice' | 'piper';
  latencyMode: LatencyMode;
  playbackBufferMs: number;
  lagDropMs: number;
  showSubtitles: boolean;
  showOriginalText: boolean;
  debugLogging: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  localEngineUrl: 'ws://127.0.0.1:8765/ws',
  localEngineToken: '',
  sourceLang: 'en',
  targetLang: 'zh',
  asrProvider: 'funasr',
  mtProvider: 'argos',
  ttsProvider: 'piper',
  latencyMode: 'low-latency',
  playbackBufferMs: 2000,
  lagDropMs: 5000,
  showSubtitles: true,
  showOriginalText: true,
  debugLogging: false,
};

export type PipelineState =
  | 'idle'
  | 'checking-engine'
  | 'engine-offline'
  | 'loading-models'
  | 'ready'
  | 'capturing'
  | 'streaming'
  | 'playing'
  | 'paused'
  | 'error';

export interface CaptureStats {
  chunks: number;
  bytes: number;
  durationMs: number;
  sampleRate: number;
  rms: number;
  peak: number;
  lastChunkAt: number | null;
}

export interface RuntimeStatus {
  state: PipelineState;
  engineConnected: boolean;
  currentTabId: number | null;
  sourceLang: LangCode;
  targetLang: LangCode;
  lagMs: number;
  queueDepth: number;
  capture: CaptureStats;
  asrText: string;
  translatedText: string;
  error: string | null;
}

export const EMPTY_CAPTURE_STATS: CaptureStats = {
  chunks: 0,
  bytes: 0,
  durationMs: 0,
  sampleRate: 16000,
  rms: 0,
  peak: 0,
  lastChunkAt: null,
};

export const DEFAULT_STATUS: RuntimeStatus = {
  state: 'idle',
  engineConnected: false,
  currentTabId: null,
  sourceLang: DEFAULT_SETTINGS.sourceLang,
  targetLang: DEFAULT_SETTINGS.targetLang,
  lagMs: 0,
  queueDepth: 0,
  capture: { ...EMPTY_CAPTURE_STATS },
  asrText: '',
  translatedText: '',
  error: null,
};

export interface SubtitlePayload {
  original: string;
  translated: string;
  hint: string;
  partial: boolean;
}
