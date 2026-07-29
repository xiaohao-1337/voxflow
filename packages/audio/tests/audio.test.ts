import assert from 'node:assert/strict';
import test from 'node:test';

import { float32ToPcm16 } from '../src/pcm.ts';
import { resampleLinear } from '../src/resample.ts';
import { decodePcm16Wav, encodePcm16Wav } from '../src/wav.ts';

test('float32ToPcm16 clips and scales samples', () => {
  assert.deepEqual(
    Array.from(float32ToPcm16(new Float32Array([-2, -1, 0, 1, 2]))),
    [-32768, -32768, 0, 32767, 32767],
  );
});

test('resampleLinear preserves duration and endpoints within one sample', () => {
  const input = Float32Array.from({ length: 48_000 }, (_, index) => index / 48_000);
  const output = resampleLinear(input, 48_000, 16_000);
  assert.equal(output.length, 16_000);
  assert.equal(output[0], input[0]);
  assert.ok(Math.abs((output.at(-1) ?? 0) - (input.at(-3) ?? 0)) < 1e-6);
});

test('PCM16 WAV encoding round-trips format and samples', () => {
  const input = new Int16Array([-32768, -10, 0, 10, 32767]);
  const decoded = decodePcm16Wav(encodePcm16Wav(input, 16_000));
  assert.equal(decoded.sampleRate, 16_000);
  assert.equal(decoded.channels, 1);
  assert.deepEqual(Array.from(decoded.samples), Array.from(input));
});

test('WAV encoder rejects incomplete interleaved stereo frames', () => {
  assert.throws(() => encodePcm16Wav(new Int16Array([1, 2, 3]), 16_000, 2), /divisible/);
});
