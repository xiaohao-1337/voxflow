export type LocalEngineClientMessage =
  | {
      v: 'voxflow.local.v1';
      type: 'session.start';
      sessionId: string;
      requestId?: string;
      pipeline: {
        stages: Array<'asr' | 'mt' | 'tts'>;
        emitIntermediates: boolean;
        latencyMode: 'realtime' | 'balanced' | 'quality';
      };
      models: {
        asr?: {
          provider: 'funasr';
          model?: string;
          language: string;
          device?: 'cpu' | 'cuda' | 'mps';
          mode?: 'streaming' | 'segment' | 'offline';
        };
        mt?: {
          provider: 'huggingface' | 'argos' | 'libretranslate' | 'ctranslate2';
          model?: string;
          sourceLang: string;
          targetLang: string;
        };
        tts?: {
          provider: 'cosyvoice' | 'piper';
          model?: string;
          voice?: string;
          language: string;
          outputAudio: {
            codec: 'pcm' | 'wav' | 'opus';
            sampleFormat: 'pcm16le';
            sampleRate: number;
            channels: 1 | 2;
          };
        };
      };
      input: {
        audio: {
          streamId: string;
          sampleRate: 16000;
          channels: 1;
          sampleFormat: 'f32le';
          codec: 'pcm';
          frameDurationMs: number;
        };
      };
    }
  | {
      v: 'voxflow.local.v1';
      type: 'audio.chunk';
      sessionId: string;
      requestId?: string;
      streamId: string;
      seq: number;
      time: {
        startMs: number;
        durationMs: number;
        mediaTimeSec?: number;
        captureUnixMs?: number;
      };
      audio: {
        transport: 'json.base64';
        codec: 'pcm';
        sampleFormat: 'f32le';
        endianness: 'little';
        sampleRate: 16000;
        channels: 1;
        channelLayout: 'mono';
        frameCount: number;
        byteLength: number;
        data: string;
      };
    }
  | {
      v: 'voxflow.local.v1';
      type: 'audio.end';
      sessionId: string;
      requestId?: string;
      streamId: string;
      lastSeq: number;
      reason: 'segment_complete' | 'stream_complete' | 'user_stop';
    }
  | {
      v: 'voxflow.local.v1';
      type: 'media.state';
      sessionId: string;
      currentTimeSec: number;
      paused: boolean;
      playbackRate: number;
    }
  | { v: 'voxflow.local.v1'; type: 'session.cancel'; sessionId: string; reason: string }
  | { v: 'voxflow.local.v1'; type: 'session.close'; sessionId: string; reason: string };

export type LocalEngineServerMessage =
  | {
      v?: 'voxflow.local.v1';
      type: 'session.started';
      sessionId: string;
      requestId?: string;
      acceptedStages: Array<'asr' | 'mt' | 'tts'>;
      message?: string;
    }
  | {
      v?: 'voxflow.local.v1';
      type: 'engine.status';
      sessionId: string;
      state: 'loading' | 'ready' | 'running' | 'draining' | 'stopped' | 'error';
      stage?: 'asr' | 'mt' | 'tts';
      message?: string;
    }
  | {
      v?: 'voxflow.local.v1';
      type: 'audio.stats';
      sessionId: string;
      chunks: number;
      bytes: number;
      samples: number;
      durationMs: number;
      rms: number;
      peak: number;
    }
  | {
      v?: 'voxflow.local.v1';
      type: 'asr.final';
      sessionId: string;
      segmentId?: string;
      text: string;
      language?: string;
      startMs: number;
      endMs: number;
      confidence?: number;
    }
  | {
      v?: 'voxflow.local.v1';
      type: 'mt.final';
      sessionId: string;
      segmentId: string;
      source: { text: string; language: string };
      target: { text: string; language: string };
      startMs: number;
      endMs: number;
    }
  | {
      v?: 'voxflow.local.v1';
      type: 'tts.audio';
      sessionId: string;
      segmentId?: string;
      seq: number;
      text: string;
      audio?: {
        transport: 'json.base64';
        codec: 'pcm' | 'wav' | 'opus';
        sampleFormat: 'pcm16le';
        sampleRate: number;
        channels: 1 | 2;
        durationMs: number;
        byteLength: number;
        data: string;
      };
      audioFormat?: 'pcm16' | 'wav' | 'opus';
      sampleRate?: number;
      sourceStartMs: number;
      sourceEndMs: number;
    }
  | { v?: 'voxflow.local.v1'; type: 'tts.final'; sessionId: string; segmentId: string; chunks: number; durationMs: number }
  | {
      v?: 'voxflow.local.v1';
      type: 'result.final';
      sessionId: string;
      kind: 'asr' | 'text' | 'audio';
      segmentId: string;
      text?: string;
      sourceText?: string;
      translatedText?: string;
      sourceLang?: string;
      targetLang?: string;
      startMs: number;
      endMs: number;
    }
  | { v?: 'voxflow.local.v1'; type: 'error'; sessionId: string; code: string; message: string; recoverable?: boolean };
