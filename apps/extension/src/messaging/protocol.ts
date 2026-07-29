import type { RuntimeStatus, Settings, SubtitlePayload } from '../core/types';

export const PORT = {
  SESSION: 'voxflow:session',
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

export type SessionPortMessage =
  | { kind: 'READY'; tabId: number; url: string }
  | { kind: 'VIDEO_TIME'; current: number; paused: boolean; playbackRate: number }
  | { kind: 'SUBTITLE'; payload: SubtitlePayload }
  | { kind: 'END' };

export function isControlMessage(msg: unknown): msg is ControlMessage {
  if (!hasKind(msg)) return false;
  switch (msg.kind) {
    case 'TOGGLE':
      return typeof msg.on === 'boolean';
    case 'UPDATE_SETTINGS':
      return isRecord(msg.patch);
    case 'START_PIPELINE':
      return isRecord(msg.settings) && (typeof msg.tabId === 'number' || msg.tabId === null);
    case 'PIPELINE_STATUS':
    case 'STATUS':
      return isRecord(msg.status);
    case 'GET_STATUS':
    case 'GET_SETTINGS':
    case 'REQUEST_CAPTURE':
    case 'STOP_PIPELINE':
    case 'PING_READY':
    case 'OFFSCREEN_READY':
      return true;
    default:
      return false;
  }
}

export function isTabMessage(msg: unknown): msg is TabMessage {
  if (!hasKind(msg)) return false;
  if (msg.kind === 'START_CAPTURE' || msg.kind === 'STOP_CAPTURE') return true;
  return msg.kind === 'CAPTURE_STATE' && typeof msg.ok === 'boolean';
}

export function isSessionPortMessage(msg: unknown): msg is SessionPortMessage {
  if (!hasKind(msg)) return false;
  switch (msg.kind) {
    case 'READY':
      return typeof msg.tabId === 'number' && typeof msg.url === 'string';
    case 'VIDEO_TIME':
      return (
        typeof msg.current === 'number' &&
        typeof msg.paused === 'boolean' &&
        typeof msg.playbackRate === 'number'
      );
    case 'SUBTITLE':
      return isRecord(msg.payload);
    case 'END':
      return true;
    default:
      return false;
  }
}

function hasKind(msg: unknown): msg is Record<string, unknown> & { kind: string } {
  return isRecord(msg) && typeof msg.kind === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}
