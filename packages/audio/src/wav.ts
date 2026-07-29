import { float32ToPcm16 } from './pcm.ts';

export interface Pcm16Wav {
  sampleRate: number;
  channels: number;
  samples: Int16Array;
}

export function encodePcm16Wav(
  input: Float32Array | Int16Array,
  sampleRate: number,
  channels = 1,
): ArrayBuffer {
  assertAudioFormat(sampleRate, channels);
  if (input.length % channels !== 0) {
    throw new RangeError('sample count must be divisible by the channel count');
  }
  const samples = input instanceof Float32Array ? float32ToPcm16(input) : input;
  const dataBytes = samples.length * Int16Array.BYTES_PER_ELEMENT;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeFourCc(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeFourCc(view, 8, 'WAVE');
  writeFourCc(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeFourCc(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index++) {
    view.setInt16(44 + index * 2, samples[index] ?? 0, true);
  }
  return buffer;
}

export function decodePcm16Wav(buffer: ArrayBuffer): Pcm16Wav {
  const view = new DataView(buffer);
  if (view.byteLength < 44 || readFourCc(view, 0) !== 'RIFF' || readFourCc(view, 8) !== 'WAVE') {
    throw new Error('invalid WAV header');
  }

  let offset = 12;
  let format: { sampleRate: number; channels: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readFourCc(view, offset);
    const chunkLength = view.getUint32(offset + 4, true);
    const contentOffset = offset + 8;
    if (contentOffset + chunkLength > view.byteLength) throw new Error('truncated WAV chunk');
    if (chunkId === 'fmt ') {
      if (chunkLength < 16) throw new Error('invalid WAV fmt chunk');
      const audioFormat = view.getUint16(contentOffset, true);
      const channels = view.getUint16(contentOffset + 2, true);
      const sampleRate = view.getUint32(contentOffset + 4, true);
      const bitsPerSample = view.getUint16(contentOffset + 14, true);
      if (audioFormat !== 1 || bitsPerSample !== 16) {
        throw new Error('only PCM16 WAV audio is supported');
      }
      assertAudioFormat(sampleRate, channels);
      format = { sampleRate, channels };
    } else if (chunkId === 'data') {
      dataOffset = contentOffset;
      dataLength = chunkLength;
    }
    offset = contentOffset + chunkLength + (chunkLength % 2);
  }
  if (!format || dataOffset < 0 || dataLength % 2 !== 0) {
    throw new Error('WAV is missing a valid fmt or data chunk');
  }

  const samples = new Int16Array(dataLength / 2);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = view.getInt16(dataOffset + index * 2, true);
  }
  return { ...format, samples };
}

function assertAudioFormat(sampleRate: number, channels: number): void {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError('sampleRate must be a positive integer');
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > 2) {
    throw new RangeError('channels must be 1 or 2');
  }
}

function writeFourCc(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < 4; index++) view.setUint8(offset + index, value.charCodeAt(index));
}

function readFourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}
