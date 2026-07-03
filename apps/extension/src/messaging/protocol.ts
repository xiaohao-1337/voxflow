import type { RuntimeStatus, Settings, SubtitlePayload } from '../core/types';

export const PORT = {
  PCM: 'voxflow:pcm',
} as const;

export type ControlMessage =
  | { kind: 'TOGGLE'; on: boolean }
  | { kind: 'GET_STATUS' }
  | { kind: 'GET_SETTINGS' }
  | { kind: 'UPDATE_SETTINGS'; patch: Partial<Settings> }
  | { kind: 'REQUEST_CAPTURE' }
  | { kind: 'START_PIPELINE'; settings: Settings; tabId: number | null; streamId?: string | null }
  | { kind: 'STOP_PIPELINE' }
  | { kind: 'PING_READY' }
  | { kind: 'OFFSCREEN_READY' }
  | { kind: 'PIPELINE_STATUS'; status: RuntimeStatus }
  | { kind: 'STATUS'; status: RuntimeStatus };

export type TabMessage =
  | { kind: 'START_CAPTURE' }
  | { kind: 'STOP_CAPTURE' }
  | { kind: 'CAPTURE_STATE'; ok: boolean; reason?: string };

export type PcmPortMessage =
  | { kind: 'READY'; tabId: number; url: string }
  | {
      kind: 'PCM';
      seq: number;
      samples: number[];
      sampleRate: number;
      timestamp: number;
      videoTime: number;
      rms: number;
      peak: number;
    }
  | { kind: 'VIDEO_TIME'; current: number; paused: boolean; playbackRate: number }
  | { kind: 'SUBTITLE'; payload: SubtitlePayload }
  | { kind: 'END' };
