const TARGET_RATE = 16000;
const CHUNK_FRAMES = 480; // 30ms at 16kHz

class VoxflowPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sourceRate = sampleRate;
    this.ratio = this.sourceRate / TARGET_RATE;
    this.sourceBuffer = [];
    this.outputBuffer = [];
    this.readPos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const channels = input.length;
    const frameCount = input[0].length;
    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel++) sum += input[channel][i] || 0;
      this.sourceBuffer.push(sum / channels);
    }

    while (this.readPos + 1 < this.sourceBuffer.length) {
      const index = Math.floor(this.readPos);
      const fraction = this.readPos - index;
      const s0 = this.sourceBuffer[index] || 0;
      const s1 = this.sourceBuffer[index + 1] || s0;
      this.outputBuffer.push(s0 + (s1 - s0) * fraction);
      this.readPos += this.ratio;
    }

    const consumed = Math.floor(this.readPos);
    if (consumed > 0) {
      this.sourceBuffer.splice(0, consumed);
      this.readPos -= consumed;
    }

    while (this.outputBuffer.length >= CHUNK_FRAMES) {
      const frame = new Float32Array(CHUNK_FRAMES);
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < CHUNK_FRAMES; i++) {
        const sample = this.outputBuffer[i] || 0;
        frame[i] = sample;
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        sumSq += sample * sample;
      }
      this.outputBuffer.splice(0, CHUNK_FRAMES);
      const rms = Math.sqrt(sumSq / CHUNK_FRAMES);
      this.port.postMessage(
        { type: 'pcm', samples: frame.buffer, sampleRate: TARGET_RATE, rms, peak },
        [frame.buffer],
      );
    }

    return true;
  }
}

registerProcessor('voxflow-pcm-capture', VoxflowPcmCaptureProcessor);
