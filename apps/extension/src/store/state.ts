import { DEFAULT_STATUS, type RuntimeStatus } from '../core/types';

let current: RuntimeStatus = { ...DEFAULT_STATUS, capture: { ...DEFAULT_STATUS.capture } };

export function getStatus(): RuntimeStatus {
  return current;
}

export function setStatus(patch: Partial<RuntimeStatus>): RuntimeStatus {
  current = {
    ...current,
    ...patch,
    capture: patch.capture ? { ...patch.capture } : current.capture,
  };
  return current;
}

export function resetStatus(): RuntimeStatus {
  current = { ...DEFAULT_STATUS, capture: { ...DEFAULT_STATUS.capture } };
  return current;
}
