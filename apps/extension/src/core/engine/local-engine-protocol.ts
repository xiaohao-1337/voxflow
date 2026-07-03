export type LocalEngineClientMessage =
  | {
      type: 'session.start';
      sessionId: string;
      sourceLang: string;
      targetLang: string;
      sampleRate: 16000;
      asrProvider: 'funasr';
      mtProvider: 'argos' | 'libretranslate' | 'ctranslate2';
      ttsProvider: 'cosyvoice' | 'piper';
    }
  | {
      type: 'audio.chunk';
      sessionId: string;
      seq: number;
      timestampMs: number;
      sampleRate: 16000;
      format: 'f32le' | 'pcm16';
      audio: string;
    }
  | { type: 'media.state'; sessionId: string; currentTime: number; paused: boolean; playbackRate: number }
  | { type: 'session.stop'; sessionId: string };

export type LocalEngineServerMessage =
  | { type: 'engine.status'; sessionId: string; state: 'loading' | 'ready' | 'running' | 'error'; message?: string }
  | { type: 'asr.partial'; sessionId: string; text: string; startMs?: number; endMs?: number }
  | { type: 'asr.final'; sessionId: string; text: string; startMs: number; endMs: number }
  | {
      type: 'translation.final';
      sessionId: string;
      sourceText: string;
      translatedText: string;
      sourceStartMs: number;
      sourceEndMs: number;
    }
  | {
      type: 'tts.audio';
      sessionId: string;
      seq: number;
      text: string;
      audioFormat: 'pcm16' | 'wav' | 'opus';
      sampleRate: number;
      sourceStartMs: number;
      sourceEndMs: number;
      audio: string;
    }
  | { type: 'error'; sessionId: string; code: string; message: string };
