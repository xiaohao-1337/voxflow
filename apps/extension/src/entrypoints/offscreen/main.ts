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
const ENGINE_RECONNECT_MS = 2000;
const PROTOCOL_VERSION = 'voxflow.local.v1' as const;

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
let engineReconnectTimer: number | null = null;

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

function onPcm(samples: ArrayLike<number>, sampleRate: number, rms: number, peak: number): void {
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
  appendSegment(samples instanceof Float32Array ? samples : new Float32Array(samples), sampleRate);
  if (capture.chunks % 12 === 0 && !lastTranslatedText) {
    sendSubtitle(`Capturing tab audio: ${formatSeconds(capture.durationMs)}. Waiting for translated text...`);
  }
}

function emitStatus(patch: Partial<RuntimeStatus> = {}): void {
  const state = patch.state ?? (capture.chunks > 0 ? 'streaming' : settings ? 'ready' : 'idle');
  const status: RuntimeStatus = {
    state,
    engineConnected: engineReady && Boolean(engine?.connected),
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
  if (!settings || engine) return;
  const client = new LocalEngineClient(settings.localEngineUrl, settings.localEngineToken);
  engine = client;
  client.onMessage(onEngineMessage);
  client.onError((error) => {
    if (engine !== client) return;
    lastError = error instanceof Error ? error.message : `Local engine error: ${settings?.localEngineUrl ?? ''}`;
    emitStatus({ state: 'engine-offline', engineConnected: client.connected, error: lastError });
    sendSubtitle(lastError);
  });
  client.onClose(() => {
    if (engine !== client) return;
    engine = null;
    engineReady = false;
    segmentBusy = false;
    lastError = `Local engine disconnected: ${settings?.localEngineUrl ?? ''}`;
    emitStatus({ state: 'engine-offline', engineConnected: false, error: lastError });
    sendSubtitle(`${lastError}. Retrying...`);
    scheduleEngineReconnect();
  });
  try {
    await client.connect();
    if (engine !== client) {
      client.close();
      return;
    }
    engineReady = true;
    lastError = null;
    emitStatus({ state: 'ready', engineConnected: true });
    sendSubtitle('Local engine connected. Capturing audio...');
  } catch (error) {
    if (engine !== client) return;
    engine = null;
    engineReady = false;
    client.close();
    lastError = error instanceof Error ? error.message : String(error);
    emitStatus({ state: 'engine-offline', engineConnected: false, error: lastError });
    sendSubtitle(`${lastError}. Retrying...`);
    scheduleEngineReconnect();
  }
}

function stopEngine(): void {
  if (engineReconnectTimer !== null) window.clearTimeout(engineReconnectTimer);
  engineReconnectTimer = null;
  engineReady = false;
  const client = engine;
  engine = null;
  try {
    client?.close();
  } catch {
    // Ignore a closed WebSocket.
  }
}

function scheduleEngineReconnect(): void {
  if (!settings || engineReconnectTimer !== null) return;
  engineReconnectTimer = window.setTimeout(() => {
    engineReconnectTimer = null;
    void connectEngine();
  }, ENGINE_RECONNECT_MS);
}

function appendSegment(samples: Float32Array, sampleRate: number): void {
  if (!settings || sampleRate !== 16000) return;
  if (!segmentStartedAt) segmentStartedAt = performance.now();
  segmentSamples.push(samples);
  segmentFrames += samples.length;
  let durationMs = (segmentFrames / sampleRate) * 1000;
  if (durationMs > MAX_SEGMENT_MS) {
    trimSegmentBuffer(Math.round((sampleRate * MAX_SEGMENT_MS) / 1000));
    durationMs = (segmentFrames / sampleRate) * 1000;
    if (!engineReady || !engine?.connected) {
      sendSubtitle(`Local engine is offline. Keeping only the latest ${formatSeconds(durationMs)} of audio...`);
    }
  }
  if (!segmentBusy && engineReady && engine?.connected && durationMs >= SEGMENT_MS) {
    const merged = drainSegment();
    void translateSegment(merged, sampleRate, durationMs);
  }
}

function trimSegmentBuffer(maxFrames: number): void {
  let excess = segmentFrames - maxFrames;
  while (excess > 0 && segmentSamples.length > 0) {
    const first = segmentSamples[0];
    if (!first) break;
    if (first.length <= excess) {
      segmentSamples.shift();
      segmentFrames -= first.length;
      excess -= first.length;
      continue;
    }
    segmentSamples[0] = first.subarray(excess);
    segmentFrames -= excess;
    excess = 0;
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
      v: PROTOCOL_VERSION,
      type: 'session.start',
      sessionId,
      requestId: `${sessionId}-start`,
      pipeline: {
        stages: ['asr', 'mt'],
        emitIntermediates: true,
        latencyMode: settings.latencyMode === 'low-latency' ? 'realtime' : 'balanced',
      },
      models: {
        asr: {
          provider: settings.asrProvider,
          language: normalizeLang(settings.sourceLang),
          mode: 'segment',
        },
        mt: {
          provider: settings.mtProvider,
          sourceLang: normalizeLang(settings.sourceLang),
          targetLang: normalizeLang(settings.targetLang),
        },
      },
      input: {
        audio: {
          streamId: 'tab-audio-main',
          sampleRate: 16000,
          channels: 1,
          sampleFormat: 'f32le',
          codec: 'pcm',
          frameDurationMs: ENGINE_CHUNK_MS,
        },
      },
    });
    const baseTimestampMs = Math.max(0, Math.round(capture.durationMs - durationMs));
    const chunkFrames = Math.max(1, Math.round((sampleRate * ENGINE_CHUNK_MS) / 1000));
    let seq = 0;
    for (let offset = 0; offset < samples.length; offset += chunkFrames) {
      const chunk = samples.subarray(offset, Math.min(samples.length, offset + chunkFrames));
      const chunkDurationMs = Math.round((chunk.length / sampleRate) * 1000);
      engine.send({
        v: PROTOCOL_VERSION,
        type: 'audio.chunk',
        sessionId,
        requestId: `${sessionId}-audio-${seq}`,
        streamId: 'tab-audio-main',
        seq,
        time: {
          startMs: baseTimestampMs + Math.round((offset / sampleRate) * 1000),
          durationMs: chunkDurationMs,
          captureUnixMs: Date.now(),
        },
        audio: {
          transport: 'json.base64',
          codec: 'pcm',
          sampleFormat: 'f32le',
          endianness: 'little',
          sampleRate: 16000,
          channels: 1,
          channelLayout: 'mono',
          frameCount: chunk.length,
          byteLength: chunk.byteLength,
          data: encodeF32leBase64(chunk),
        },
      });
      seq += 1;
    }
    engine.send({
      v: PROTOCOL_VERSION,
      type: 'audio.end',
      sessionId,
      requestId: `${sessionId}-audio-end`,
      streamId: 'tab-audio-main',
      lastSeq: seq - 1,
      reason: 'segment_complete',
    });
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
      if (message.state === 'stopped') segmentBusy = false;
      if (message.state === 'error') {
        segmentBusy = false;
        lastError = message.message ?? 'Local engine pipeline failed';
        emitStatus({ state: 'error', engineConnected: true, error: lastError });
        sendSubtitle(lastError);
        break;
      }
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
    case 'mt.final':
      lastAsrText = message.source.text;
      lastTranslatedText = message.target.text;
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
    case 'result.final':
      if (message.kind === 'asr' && message.text) {
        lastAsrText = message.text;
      } else if ((message.kind === 'text' || message.kind === 'audio') && message.translatedText) {
        lastAsrText = message.sourceText ?? lastAsrText;
        lastTranslatedText = message.translatedText;
        sendSubtitle('Translated by local FunASR pipeline.');
      }
      emitStatus({
        state: 'streaming',
        engineConnected: true,
        asrText: lastAsrText,
        translatedText: lastTranslatedText,
        error: null,
      });
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
    onPcm(new Float32Array(data.samples), data.sampleRate, data.rms ?? 0, data.peak ?? 0);
  };

  node.port.addEventListener('message', onMessage);
  node.port.start();
  source.connect(node);
  const silentSink = ctx.createGain();
  silentSink.gain.value = 0;
  node.connect(silentSink);
  silentSink.connect(ctx.destination);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

  return {
    stop() {
      node.port.removeEventListener('message', onMessage);
      node.port.close();
      try {
        source.disconnect();
        node.disconnect();
        silentSink.disconnect();
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
