import { PCM_CAPTURE_PROCESSOR_NAME, getPcmCaptureWorkletUrl, type PcmFrame } from './pcm-capture.worklet';

export interface AudioCaptureCallbacks {
  onPcm(frame: PcmFrame): void;
  onVideoTime?(state: { current: number; paused: boolean; playbackRate: number }): void;
}

export interface AudioCaptureHandle {
  stop(): void;
}

interface MediaElementGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
}

const graphs = new WeakMap<HTMLMediaElement, MediaElementGraph>();

export async function startAudioCapture(
  video: HTMLVideoElement,
  callbacks: AudioCaptureCallbacks,
): Promise<AudioCaptureHandle> {
  const graph = await getOrCreateGraph(video);

  const node = new AudioWorkletNode(graph.ctx, PCM_CAPTURE_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
  });
  const sink = graph.ctx.createMediaStreamDestination();

  graph.source.connect(node);
  node.connect(sink);

  const onMessage = (event: MessageEvent) => {
    const data = event.data as
      | { type?: string; samples?: ArrayBuffer; sampleRate?: number; rms?: number; peak?: number }
      | undefined;
    if (data?.type !== 'pcm' || !data.samples || !data.sampleRate) return;
    callbacks.onPcm({
      samples: new Float32Array(data.samples),
      sampleRate: data.sampleRate,
      rms: data.rms ?? 0,
      peak: data.peak ?? 0,
    });
  };
  node.port.addEventListener('message', onMessage);
  node.port.start();

  if (graph.ctx.state === 'suspended') await graph.ctx.resume().catch(() => undefined);

  const timer = window.setInterval(() => {
    callbacks.onVideoTime?.({
      current: video.currentTime,
      paused: video.paused,
      playbackRate: video.playbackRate,
    });
  }, 250);

  return {
    stop() {
      window.clearInterval(timer);
      node.port.removeEventListener('message', onMessage);
      node.port.close();
      try {
        graph.source.disconnect(node);
        node.disconnect();
        sink.disconnect();
      } catch {
        // Ignore already-disconnected Web Audio nodes.
      }
    },
  };
}

async function getOrCreateGraph(video: HTMLVideoElement): Promise<MediaElementGraph> {
  const existing = graphs.get(video);
  if (existing && existing.ctx.state !== 'closed') {
    await existing.ctx.audioWorklet.addModule(getPcmCaptureWorkletUrl()).catch(() => undefined);
    return existing;
  }

  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(getPcmCaptureWorkletUrl());

  try {
    const source = ctx.createMediaElementSource(video);
    const graph = { ctx, source };
    graphs.set(video, graph);
    return graph;
  } catch (error) {
    void ctx.close();
    throw error instanceof Error ? error : new Error(String(error));
  }
}
