export interface SilenceSegmenterConfig {
  minSegmentMs: number;
  maxSegmentMs: number;
  trailingSilenceMs: number;
  preRollMs: number;
  minRmsThreshold: number;
  maxRmsThreshold: number;
  noiseMultiplier: number;
}

export type SegmentationAction =
  | { kind: 'continue' }
  | { kind: 'trim-idle'; keepMs: number }
  | { kind: 'flush'; reason: 'silence' | 'max-duration' };

export const DEFAULT_SILENCE_SEGMENTER_CONFIG: SilenceSegmenterConfig = {
  minSegmentMs: 1200,
  maxSegmentMs: 7000,
  trailingSilenceMs: 450,
  preRollMs: 240,
  minRmsThreshold: 0.006,
  maxRmsThreshold: 0.03,
  noiseMultiplier: 3,
};

export class SilenceSegmenter {
  private noiseFloor = 0.002;
  private speechStarted = false;
  private silenceMs = 0;
  private readonly config: SilenceSegmenterConfig;

  constructor(config: SilenceSegmenterConfig = DEFAULT_SILENCE_SEGMENTER_CONFIG) {
    this.config = config;
  }

  observe(
    rms: number,
    peak: number,
    frameDurationMs: number,
    bufferedDurationMs: number,
  ): SegmentationAction {
    const threshold = Math.max(
      this.config.minRmsThreshold,
      Math.min(this.config.maxRmsThreshold, this.noiseFloor * this.config.noiseMultiplier),
    );
    const speech = rms >= threshold || peak >= threshold * 3;

    if (!this.speechStarted) {
      if (speech) {
        this.speechStarted = true;
        this.silenceMs = 0;
      } else {
        this.noiseFloor = this.noiseFloor * 0.95 + Math.max(0, rms) * 0.05;
        if (bufferedDurationMs > this.config.preRollMs) {
          return { kind: 'trim-idle', keepMs: this.config.preRollMs };
        }
      }
      return { kind: 'continue' };
    }

    this.silenceMs = speech ? 0 : this.silenceMs + Math.max(0, frameDurationMs);
    if (bufferedDurationMs >= this.config.maxSegmentMs) {
      return { kind: 'flush', reason: 'max-duration' };
    }
    if (
      bufferedDurationMs >= this.config.minSegmentMs &&
      this.silenceMs >= this.config.trailingSilenceMs
    ) {
      return { kind: 'flush', reason: 'silence' };
    }
    return { kind: 'continue' };
  }

  reset(): void {
    this.speechStarted = false;
    this.silenceMs = 0;
  }
}
