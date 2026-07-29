const TARGET_RATE = 16000;
const CHUNK_FRAMES = 480; // 30ms at 16kHz

class VoxflowPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sourceRate = sampleRate;
    this.ratio = this.sourceRate / TARGET_RATE;
    this.sourceIndex = -1;
    this.nextOutputPosition = 0;
    this.previousSample = 0;
    this.hasPreviousSample = false;
    this.outputFrame = new Float32Array(CHUNK_FRAMES);
    this.outputIndex = 0;
    this.outputSumSq = 0;
    this.outputPeak = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const channels = input.length;
    const frameCount = input[0].length;
    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel++) sum += input[channel][i] || 0;
      this.pushSourceSample(sum / channels);
    }

    return true;
  }

  pushSourceSample(sample) {
    this.sourceIndex += 1;
    if (!this.hasPreviousSample) {
      this.previousSample = sample;
      this.hasPreviousSample = true;
      this.pushOutputSample(sample);
      this.nextOutputPosition = this.ratio;
      return;
    }

    const leftPosition = this.sourceIndex - 1;
    while (this.nextOutputPosition <= this.sourceIndex) {
      const fraction = this.nextOutputPosition - leftPosition;
      const output = this.previousSample + (sample - this.previousSample) * fraction;
      this.pushOutputSample(output);
      this.nextOutputPosition += this.ratio;
    }
    this.previousSample = sample;
  }

  pushOutputSample(sample) {
    this.outputFrame[this.outputIndex] = sample;
    this.outputIndex += 1;
    const absolute = Math.abs(sample);
    this.outputPeak = Math.max(this.outputPeak, absolute);
    this.outputSumSq += sample * sample;
    if (this.outputIndex < CHUNK_FRAMES) return;

    const frame = this.outputFrame;
    const rms = Math.sqrt(this.outputSumSq / CHUNK_FRAMES);
    const peak = this.outputPeak;
    this.outputFrame = new Float32Array(CHUNK_FRAMES);
    this.outputIndex = 0;
    this.outputSumSq = 0;
    this.outputPeak = 0;
    this.port.postMessage(
      { type: 'pcm', samples: frame.buffer, sampleRate: TARGET_RATE, rms, peak },
      [frame.buffer],
    );
  }
}

registerProcessor('voxflow-pcm-capture', VoxflowPcmCaptureProcessor);
