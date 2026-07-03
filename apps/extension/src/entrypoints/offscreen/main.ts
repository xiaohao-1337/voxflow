import { EMPTY_CAPTURE_STATS, type CaptureStats, type RuntimeStatus, type Settings } from '../../core/types';
import { PCM_CAPTURE_PROCESSOR_NAME, getPcmCaptureWorkletUrl } from '../../core/audio/pcm-capture.worklet';
import { encodeF32leBase64, LocalEngineClient } from '../../core/engine/local-engine-client';
import type { LocalEngineServerMessage } from '../../core/engine/local-engine-protocol';
import { onControlMessage, onPcmPortConnect, sendControl } from '../../messaging/bridge';
import { PORT } from '../../messaging/protocol';
import type { PcmPort } from '../../messaging/bridge';

const SEGMENT_MS = 7000;
const MIN_SEGMENT_MS = 1200;
const MAX_SEGMENT_MS = 12000;
const ENGINE_CHUNK_MS = 200;

let settings: Settings | null = null;
let currentTabId: number | null = null;
let contentPort: PcmPort | null = null;
let capture: CaptureStats = { ...EMPTY_CAPTURE_STATS };
let statusTimer: number | null = null;
let startedAt: number | null = null;
let engine: LocalEngineClient | null = null;
let sessionSeq = 0;
let segmentSamples: Float32Array[] = [];
let segmentFrames = 0;
let segmentStartedAt = 0;
let segmentBusy = false;
let lastAsrText = '';
let lastTranslatedText = '';
let lastError: string | null = null;
let tabCaptureHandle: TabCaptureHandle | null = null;
let engineReady = false;

sendControl({ kind: 'OFFSCREEN_READY' }).catch(() => undefined);

onControlMessage((msg) => {
  switch (msg.kind) {
    case 'PING_READY':
      sendControl({ kind: 'OFFSCREEN_READY' }).catch(() => undefined);
      break;
    case 'START_PIPELINE':
      void startPipeline(msg.settings, msg.tabId, msg.streamId ?? null);
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

async function startPipeline(nextSettings: Settings, tabId: number | null, streamId: string | null): Promise<void> {
  stopEngine();
  stopTabCapture();
  settings = nextSettings;
  currentTabId = tabId;
  capture = { ...EMPTY_CAPTURE_STATS };
  startedAt = performance.now();
  segmentSamples = [];
  segmentFrames = 0;
  segmentStartedAt = 0;
  segmentBusy = false;
  engineReady = false;
  lastAsrText = '';
  lastTranslatedText = '';
  lastError = null;
  if (statusTimer !== null) window.clearInterval(statusTimer);
  statusTimer = window.setInterval(() => emitStatus(), 1000);
  void connectEngine();
  emitStatus({ state: 'checking-engine' });
  if (streamId) {
    try {
      tabCaptureHandle = await startTabCapture(streamId);
      emitStatus({ state: 'capturing' });
      sendSubtitle('Tab audio capture is active. Waiting for translated text...');
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      emitStatus({ state: 'error', error: lastError });
      sendSubtitle(lastError);
    }
  }
}

function stopPipeline(): void {
  if (statusTimer !== null) window.clearInterval(statusTimer);
  statusTimer = null;
  settings = null;
  currentTabId = null;
  contentPort = null;
  capture = { ...EMPTY_CAPTURE_STATS };
  startedAt = null;
  segmentSamples = [];
  segmentFrames = 0;
  segmentStartedAt = 0;
  segmentBusy = false;
  engineReady = false;
  lastAsrText = '';
  lastTranslatedText = '';
  lastError = null;
  stopTabCapture();
  stopEngine();
  emitStatus({ state: 'idle' });
}

function onPcm(samples: number[], sampleRate: number, rms: number, peak: number): void {
  const now = performance.now();
  const frames = samples.length;
  const bytes = samples.length * Float32Array.BYTES_PER_ELEMENT;
  capture = {
    chunks: capture.chunks + 1,
    bytes: capture.bytes + bytes,
    durationMs: capture.durationMs + (frames / sampleRate) * 1000,
    sampleRate,
    rms,
    peak,
    lastChunkAt: now,
  };
  emitStatus({ state: 'streaming' });
  appendSegment(new Float32Array(samples), sampleRate);
  if (capture.chunks % 12 === 0 && !lastTranslatedText) {
    sendSubtitle(`Capturing tab audio: ${formatSeconds(capture.durationMs)}. Waiting for translated text...`);
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
    queueDepth: segmentBusy ? 1 : 0,
    capture,
    asrText: lastAsrText,
    translatedText: lastTranslatedText,
    error: lastError,
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
      original: lastAsrText,
      translated: lastTranslatedText,
      hint,
      partial: !lastTranslatedText,
    },
  });
}

async function connectEngine(): Promise<void> {
  if (!settings) return;
  const client = new LocalEngineClient(settings.localEngineUrl, settings.localEngineToken);
  engine = client;
  client.onMessage(onEngineMessage);
  client.onError(() => {
    lastError = `Local engine error: ${settings?.localEngineUrl ?? ''}`;
    emitStatus({ state: 'engine-offline', engineConnected: false, error: lastError });
    sendSubtitle(lastError);
  });
  try {
    await client.connect();
    if (engine !== client) {
      client.close();
      return;
    }
    engineReady = true;
    emitStatus({ state: 'ready', engineConnected: true });
    sendSubtitle('Local engine connected. Capturing audio...');
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    emitStatus({ state: 'engine-offline', engineConnected: false, error: lastError });
    sendSubtitle(lastError);
  }
}

function stopEngine(): void {
  try {
    engine?.close();
  } catch {
    // Ignore a closed WebSocket.
  }
  engine = null;
}

function appendSegment(samples: Float32Array, sampleRate: number): void {
  if (!settings || sampleRate !== 16000) return;
  if (!segmentStartedAt) segmentStartedAt = performance.now();
  segmentSamples.push(samples);
  segmentFrames += samples.length;
  const durationMs = (segmentFrames / sampleRate) * 1000;
  if (!segmentBusy && engineReady && engine?.connected && durationMs >= SEGMENT_MS) {
    const merged = drainSegment();
    void translateSegment(merged, sampleRate, durationMs);
  } else if (!segmentBusy && durationMs >= MAX_SEGMENT_MS && (!engineReady || !engine?.connected)) {
    sendSubtitle(`Captured ${formatSeconds(durationMs)}. Waiting for local engine connection...`);
  }
}

function drainSegment(): Float32Array {
  const merged = new Float32Array(segmentFrames);
  let offset = 0;
  for (const chunk of segmentSamples) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  segmentSamples = [];
  segmentFrames = 0;
  segmentStartedAt = 0;
  return merged;
}

async function translateSegment(samples: Float32Array, sampleRate: number, durationMs: number): Promise<void> {
  if (!settings || !engine?.connected || samples.length < (sampleRate * MIN_SEGMENT_MS) / 1000) return;
  segmentBusy = true;
  sendSubtitle(`Translating ${formatSeconds(durationMs)} of captured audio...`);
  const sessionId = `voxflow-${Date.now()}-${sessionSeq++}`;
  try {
    engine.send({
      type: 'session.start',
      sessionId,
      sourceLang: normalizeLang(settings.sourceLang),
      targetLang: normalizeLang(settings.targetLang),
      sampleRate: 16000,
      asrProvider: 'funasr',
      mtProvider: settings.mtProvider,
      ttsProvider: settings.ttsProvider,
    });
    const baseTimestampMs = Math.max(0, Math.round(capture.durationMs - durationMs));
    const chunkFrames = Math.max(1, Math.round((sampleRate * ENGINE_CHUNK_MS) / 1000));
    let seq = 0;
    for (let offset = 0; offset < samples.length; offset += chunkFrames) {
      const chunk = samples.subarray(offset, Math.min(samples.length, offset + chunkFrames));
      engine.send({
        type: 'audio.chunk',
        sessionId,
        seq,
        timestampMs: baseTimestampMs + Math.round((offset / sampleRate) * 1000),
        sampleRate: 16000,
        format: 'f32le',
        audio: encodeF32leBase64(chunk),
      });
      seq += 1;
    }
    engine.send({ type: 'session.stop', sessionId });
    emitStatus({ state: 'streaming', engineConnected: true });
  } catch (error) {
    segmentBusy = false;
    lastError = error instanceof Error ? error.message : String(error);
    emitStatus({ state: 'error', error: lastError, engineConnected: false });
    sendSubtitle(lastError);
  }
}

function onEngineMessage(message: LocalEngineServerMessage): void {
  switch (message.type) {
    case 'engine.status':
      if (message.message === 'stopped') segmentBusy = false;
      emitStatus({ state: capture.chunks > 0 ? 'streaming' : 'ready', engineConnected: true });
      if (!segmentBusy && segmentFrames >= (16000 * SEGMENT_MS) / 1000 && engine?.connected) {
        const durationMs = (segmentFrames / 16000) * 1000;
        const merged = drainSegment();
        void translateSegment(merged, 16000, durationMs);
      }
      break;
    case 'asr.final':
      lastAsrText = message.text;
      emitStatus({ asrText: lastAsrText, engineConnected: true });
      break;
    case 'translation.final':
      lastAsrText = message.sourceText;
      lastTranslatedText = message.translatedText;
      lastError = null;
      emitStatus({
        state: 'streaming',
        engineConnected: true,
        asrText: lastAsrText,
        translatedText: lastTranslatedText,
        error: null,
      });
      sendSubtitle('Translated by local FunASR pipeline.');
      break;
    case 'error':
      segmentBusy = false;
      lastError = message.message;
      emitStatus({ state: 'error', error: lastError, engineConnected: true });
      sendSubtitle(lastError);
      break;
    default:
      break;
  }
}

function normalizeLang(lang: Settings['sourceLang'] | Settings['targetLang']): string {
  return lang === 'auto' ? 'en' : lang;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

interface TabCaptureHandle {
  stop(): void;
}

async function startTabCapture(streamId: string): Promise<TabCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    } as MediaTrackConstraints,
    video: false,
  });

  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(getPcmCaptureWorkletUrl());

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, PCM_CAPTURE_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
  });

  const onMessage = (event: MessageEvent) => {
    const data = event.data as
      | { type?: string; samples?: ArrayBuffer; sampleRate?: number; rms?: number; peak?: number }
      | undefined;
    if (data?.type !== 'pcm' || !data.samples || !data.sampleRate) return;
    onPcm(Array.from(new Float32Array(data.samples)), data.sampleRate, data.rms ?? 0, data.peak ?? 0);
  };

  node.port.addEventListener('message', onMessage);
  node.port.start();
  source.connect(node);
  node.connect(ctx.destination);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

  return {
    stop() {
      node.port.removeEventListener('message', onMessage);
      node.port.close();
      try {
        source.disconnect();
        node.disconnect();
      } catch {
        // Ignore already disconnected audio nodes.
      }
      for (const track of stream.getTracks()) track.stop();
      void ctx.close();
    },
  };
}

function stopTabCapture(): void {
  try {
    tabCaptureHandle?.stop();
  } catch {
    // Ignore stopped capture handles.
  }
  tabCaptureHandle = null;
}
