export const PCM_CAPTURE_PROCESSOR_NAME = 'voxflow-pcm-capture';

export interface PcmFrame {
  samples: Float32Array;
  sampleRate: number;
  rms: number;
  peak: number;
}

export function getPcmCaptureWorkletUrl(): string {
  return chrome.runtime.getURL('voxflow-pcm-capture.worklet.js');
}
