import { EMPTY_CAPTURE_STATS, type CaptureStats, type RuntimeStatus, type Settings } from '../../core/types';
import { onControlMessage, onPcmPortConnect, sendControl } from '../../messaging/bridge';
import { PORT } from '../../messaging/protocol';
import type { PcmPort } from '../../messaging/bridge';

let settings: Settings | null = null;
let currentTabId: number | null = null;
let contentPort: PcmPort | null = null;
let capture: CaptureStats = { ...EMPTY_CAPTURE_STATS };
let statusTimer: number | null = null;
let startedAt: number | null = null;

sendControl({ kind: 'OFFSCREEN_READY' }).catch(() => undefined);

onControlMessage(async (msg) => {
  switch (msg.kind) {
    case 'PING_READY':
      sendControl({ kind: 'OFFSCREEN_READY' }).catch(() => undefined);
      break;
    case 'START_PIPELINE':
      startPipeline(msg.settings, msg.tabId);
      break;
    case 'STOP_PIPELINE':
      stopPipeline();
      break;
    default:
      break;
  }
});

onPcmPortConnect(PORT.PCM, (port) => {
  contentPort = port;
  port.onDisconnect(() => {
    if (contentPort === port) contentPort = null;
    emitStatus({ state: settings?.enabled ? 'ready' : 'idle' });
  });
  port.on((msg) => {
    switch (msg.kind) {
      case 'READY':
        emitStatus({ state: 'capturing', currentTabId: msg.tabId || currentTabId });
        sendSubtitle('Audio capture is active. Waiting for PCM frames...');
        break;
      case 'PCM':
        onPcm(msg.samples, msg.sampleRate, msg.rms, msg.peak);
        break;
      case 'VIDEO_TIME':
        void msg;
        break;
      case 'END':
        stopPipeline();
        break;
      default:
        break;
    }
  });
});

function startPipeline(nextSettings: Settings, tabId: number | null): void {
  settings = nextSettings;
  currentTabId = tabId;
  capture = { ...EMPTY_CAPTURE_STATS };
  startedAt = performance.now();
  if (statusTimer !== null) window.clearInterval(statusTimer);
  statusTimer = window.setInterval(() => emitStatus(), 1000);
  emitStatus({ state: 'ready' });
}

function stopPipeline(): void {
  if (statusTimer !== null) window.clearInterval(statusTimer);
  statusTimer = null;
  settings = null;
  currentTabId = null;
  contentPort = null;
  capture = { ...EMPTY_CAPTURE_STATS };
  startedAt = null;
  emitStatus({ state: 'idle' });
}

function onPcm(samples: ArrayBuffer, sampleRate: number, rms: number, peak: number): void {
  const now = performance.now();
  const frames = samples.byteLength / Float32Array.BYTES_PER_ELEMENT;
  capture = {
    chunks: capture.chunks + 1,
    bytes: capture.bytes + samples.byteLength,
    durationMs: capture.durationMs + (frames / sampleRate) * 1000,
    sampleRate,
    rms,
    peak,
    lastChunkAt: now,
  };
  emitStatus({ state: 'streaming' });
  if (capture.chunks % 12 === 0) {
    sendSubtitle(`Captured ${capture.chunks} chunks, rms=${rms.toFixed(4)}, peak=${peak.toFixed(4)}`);
  }
}

function emitStatus(patch: Partial<RuntimeStatus> = {}): void {
  const state = patch.state ?? (capture.chunks > 0 ? 'streaming' : settings ? 'ready' : 'idle');
  const status: RuntimeStatus = {
    state,
    engineConnected: false,
    currentTabId: patch.currentTabId ?? currentTabId,
    sourceLang: settings?.sourceLang ?? 'en',
    targetLang: settings?.targetLang ?? 'zh',
    lagMs: 0,
    queueDepth: 0,
    capture,
    asrText: '',
    translatedText: '',
    error: null,
    ...patch,
  };
  if (startedAt && state !== 'idle') {
    status.capture = { ...status.capture, durationMs: capture.durationMs };
  }
  sendControl({ kind: 'PIPELINE_STATUS', status }).catch(() => undefined);
}

function sendSubtitle(hint: string): void {
  contentPort?.post({
    kind: 'SUBTITLE',
    payload: {
      original: '',
      translated: '',
      hint,
      partial: true,
    },
  });
}
