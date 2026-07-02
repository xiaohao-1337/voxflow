export interface QueuedAudioSegment {
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
}

export class LagManager {
  constructor(private readonly dropMs: number) {}

  computeLagMs(queue: QueuedAudioSegment[], currentVideoMs: number): number {
    const head = queue[0];
    if (!head) return 0;
    return Math.max(0, currentVideoMs - head.sourceStartMs);
  }

  shouldDrop(queue: QueuedAudioSegment[], currentVideoMs: number): boolean {
    return this.computeLagMs(queue, currentVideoMs) > this.dropMs;
  }
}
