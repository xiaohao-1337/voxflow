import assert from 'node:assert/strict';
import test from 'node:test';

import { SilenceSegmenter } from '../src/core/audio/silence-segmenter.ts';

test('silence segmenter keeps only a short idle pre-roll', () => {
  const segmenter = new SilenceSegmenter();
  const action = segmenter.observe(0.001, 0.002, 30, 270);
  assert.deepEqual(action, { kind: 'trim-idle', keepMs: 240 });
});

test('speech followed by 450ms silence creates a natural segment', () => {
  const segmenter = new SilenceSegmenter();
  let bufferedMs = 240;
  for (let index = 0; index < 30; index++) {
    bufferedMs += 30;
    assert.equal(segmenter.observe(0.03, 0.1, 30, bufferedMs).kind, 'continue');
  }

  let action = segmenter.observe(0.001, 0.002, 30, (bufferedMs += 30));
  for (let index = 1; index < 15; index++) {
    action = segmenter.observe(0.001, 0.002, 30, (bufferedMs += 30));
  }
  assert.deepEqual(action, { kind: 'flush', reason: 'silence' });
});

test('continuous speech is force-split at the maximum duration', () => {
  const segmenter = new SilenceSegmenter();
  assert.equal(segmenter.observe(0.03, 0.1, 30, 30).kind, 'continue');
  assert.deepEqual(segmenter.observe(0.03, 0.1, 30, 7000), {
    kind: 'flush',
    reason: 'max-duration',
  });
});
