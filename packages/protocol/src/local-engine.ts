export type ProtocolVersion = 'voxflow.local.v1';
export const LOCAL_ENGINE_PROTOCOL_VERSION: ProtocolVersion = 'voxflow.local.v1';

export type PipelineStage = 'asr' | 'mt' | 'tts';
export type LatencyMode = 'realtime' | 'balanced' | 'quality';
export type AudioTransport = 'json.base64';
export type AudioCodec = 'pcm' | 'wav' | 'opus';
export type InputSampleFormat = 'f32le' | 'pcm16le';
export type OutputSampleFormat = 'pcm16le';

export interface ClientEnvelope {
  v: ProtocolVersion;
  type: string;
  sessionId: string;
  requestId?: string;
  createdAt?: number;
}

export interface ServerEnvelope {
  v: ProtocolVersion;
  type: string;
  sessionId: string;
  requestId?: string;
  eventId?: string;
  createdAt?: number;
}

export interface PipelineConfig {
  stages: PipelineStage[];
  emitIntermediates?: boolean;
  latencyMode?: LatencyMode;
}

export interface AsrModelConfig {
  provider: 'funasr';
  model?: string;
  language: string;
  device?: 'cpu' | 'cuda' | 'mps';
  mode?: 'streaming' | 'segment' | 'offline';
  vad?: {
    enabled: boolean;
    provider?: 'funasr-fsmn-vad' | 'silero';
    minSpeechMs?: number;
    maxSegmentMs?: number;
  };
  punctuation?: {
    enabled: boolean;
  };
}

export interface MtModelConfig {
  provider: 'huggingface' | 'argos' | 'libretranslate' | 'ctranslate2';
  model?: string;
  sourceLang: string;
  targetLang: string;
}

export interface TtsModelConfig {
  provider: 'piper' | 'cosyvoice';
  model?: string;
  voice?: string;
  language: string;
  outputAudio: {
    codec: AudioCodec;
    sampleFormat: OutputSampleFormat;
    sampleRate: number;
    channels: 1 | 2;
  };
}

export interface SessionStartMessage extends ClientEnvelope {
  type: 'session.start';
  pipeline: PipelineConfig;
  models: {
    asr?: AsrModelConfig;
    mt?: MtModelConfig;
    tts?: TtsModelConfig;
  };
  input: {
    audio: {
      streamId: string;
      sampleRate: number;
      channels: 1 | 2;
      sampleFormat: InputSampleFormat;
      codec: 'pcm';
      frameDurationMs?: number;
    };
  };
}

export interface AudioChunkMessage extends ClientEnvelope {
  type: 'audio.chunk';
  streamId: string;
  seq: number;
  time: {
    startMs: number;
    durationMs: number;
    mediaTimeSec?: number;
    captureUnixMs?: number;
  };
  audio: {
    transport: AudioTransport;
    codec: 'pcm';
    sampleFormat: InputSampleFormat;
    endianness: 'little';
    sampleRate: number;
    channels: 1 | 2;
    channelLayout?: 'mono' | 'stereo';
    frameCount: number;
    byteLength: number;
    data: string;
    checksum?: {
      algorithm: 'sha256';
      value: string;
    };
  };
}

export interface AudioEndMessage extends ClientEnvelope {
  type: 'audio.end';
  streamId: string;
  lastSeq: number;
  reason: 'segment_complete' | 'stream_complete' | 'user_stop';
}

export interface MediaStateMessage extends ClientEnvelope {
  type: 'media.state';
  currentTimeSec: number;
  paused: boolean;
  playbackRate: number;
}

export interface SessionCancelMessage extends ClientEnvelope {
  type: 'session.cancel';
  reason: string;
}

export interface SessionCloseMessage extends ClientEnvelope {
  type: 'session.close';
  reason: string;
}

export type LocalEngineClientMessage =
  | SessionStartMessage
  | AudioChunkMessage
  | AudioEndMessage
  | MediaStateMessage
  | SessionCancelMessage
  | SessionCloseMessage;

export interface SessionStartedEvent extends ServerEnvelope {
  type: 'session.started';
  acceptedStages: PipelineStage[];
  message?: string;
}

export interface EngineStatusEvent extends ServerEnvelope {
  type: 'engine.status';
  state: 'loading' | 'ready' | 'running' | 'draining' | 'stopped' | 'error';
  stage?: PipelineStage;
  message?: string;
}

export interface AudioStatsEvent extends ServerEnvelope {
  type: 'audio.stats';
  streamId: string;
  chunks: number;
  bytes: number;
  samples: number;
  durationMs: number;
  rms: number;
  peak: number;
}

export interface AsrFinalEvent extends ServerEnvelope {
  type: 'asr.final';
  segmentId: string;
  text: string;
  language: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface MtFinalEvent extends ServerEnvelope {
  type: 'mt.final';
  segmentId: string;
  source: {
    text: string;
    language: string;
  };
  target: {
    text: string;
    language: string;
  };
  startMs: number;
  endMs: number;
}

export interface TtsAudioEvent extends ServerEnvelope {
  type: 'tts.audio';
  segmentId: string;
  seq: number;
  text: string;
  audio: {
    transport: AudioTransport;
    codec: AudioCodec;
    sampleFormat: OutputSampleFormat;
    sampleRate: number;
    channels: 1 | 2;
    durationMs: number;
    byteLength: number;
    data: string;
  };
  sourceStartMs: number;
  sourceEndMs: number;
}

export interface TtsFinalEvent extends ServerEnvelope {
  type: 'tts.final';
  segmentId: string;
  chunks: number;
  durationMs: number;
}

export type ResultFinalEvent =
  | (ServerEnvelope & {
      type: 'result.final';
      kind: 'asr';
      segmentId: string;
      text: string;
      startMs: number;
      endMs: number;
    })
  | (ServerEnvelope & {
      type: 'result.final';
      kind: 'text';
      segmentId: string;
      sourceText: string;
      translatedText: string;
      sourceLang: string;
      targetLang: string;
      startMs: number;
      endMs: number;
    })
  | (ServerEnvelope & {
      type: 'result.final';
      kind: 'audio';
      segmentId: string;
      sourceText: string;
      translatedText: string;
      audioFormat: {
        codec: AudioCodec;
        sampleFormat: OutputSampleFormat;
        sampleRate: number;
        channels: 1 | 2;
      };
      audioChunks: number;
      startMs: number;
      endMs: number;
    });

export interface ErrorEvent extends ServerEnvelope {
  type: 'error';
  code: string;
  message: string;
  recoverable: boolean;
}

export type LocalEngineServerMessage =
  | SessionStartedEvent
  | EngineStatusEvent
  | AudioStatsEvent
  | AsrFinalEvent
  | MtFinalEvent
  | TtsAudioEvent
  | TtsFinalEvent
  | ResultFinalEvent
  | ErrorEvent;

export interface ModelHealth {
  ready: boolean;
  path: string;
  missing: string[];
}

export interface EngineHealthResponse {
  service: 'voxflow-local-engine';
  version: string;
  protocol: ProtocolVersion;
  status: 'ok' | 'degraded';
  modelState: 'cold' | 'partial' | 'ready';
  models: {
    asr: ModelHealth;
    mt: ModelHealth;
    tts: ModelHealth;
  };
  capabilities: {
    stages: PipelineStage[];
    inputSampleFormats: InputSampleFormat[];
    sourceLanguages: string[];
    targetLanguages: string[];
  };
  security: {
    tokenRequired: boolean;
    originPolicyEnabled: boolean;
  };
}
