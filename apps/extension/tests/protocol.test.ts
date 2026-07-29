import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isControlMessage,
  isSessionPortMessage,
  isTabMessage,
} from '../src/messaging/protocol.ts';

test('control messages validate their discriminant payload', () => {
  assert.equal(isControlMessage({ kind: 'TOGGLE', on: true }), true);
  assert.equal(isControlMessage({ kind: 'TOGGLE', on: 'yes' }), false);
  assert.equal(isControlMessage({ kind: 'CAPTURE_STATE', ok: true }), false);
});

test('tab messages are not accepted as control messages', () => {
  const message = { kind: 'CAPTURE_STATE', ok: false, reason: 'capture failed' };
  assert.equal(isTabMessage(message), true);
  assert.equal(isControlMessage(message), false);
});

test('session port rejects removed PCM payloads and malformed media state', () => {
  assert.equal(
    isSessionPortMessage({
      kind: 'VIDEO_TIME',
      current: 12.5,
      paused: false,
      playbackRate: 1,
    }),
    true,
  );
  assert.equal(isSessionPortMessage({ kind: 'VIDEO_TIME', current: '12.5' }), false);
  assert.equal(isSessionPortMessage({ kind: 'PCM', samples: [] }), false);
});
