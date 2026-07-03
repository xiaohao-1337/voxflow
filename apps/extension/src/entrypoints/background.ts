import { onControlMessage, onTabMessage, sendControl, sendToTab } from '../messaging/bridge';
import type { TabMessage } from '../messaging/protocol';
import { getSettings, patchSettings } from '../store/settings';
import { getStatus, resetStatus, setStatus } from '../store/state';
import type { RuntimeStatus, Settings } from '../core/types';
import { reportError } from '../lib/utils';

const OFFSCREEN_URL = 'offscreen.html';
const CONTENT_SCRIPT_PATH = 'content-scripts/content.js';
const OFFSCREEN_READY_TIMEOUT_MS = 5000;
const PING_TIMEOUT_MS = 500;

let ensureOffscreenLock: Promise<void> | null = null;

export default defineBackground(() => {
  console.log('[VoxFlow][SW] started');

  onControlMessage(async (msg, sender) => {
    switch (msg.kind) {
      case 'TOGGLE':
        await handleToggle(msg.on);
        return;
      case 'GET_STATUS':
        return getStatus();
      case 'GET_SETTINGS':
        return getSettings();
      case 'UPDATE_SETTINGS':
        return patchSettings(msg.patch);
      case 'REQUEST_CAPTURE':
        await handleRequestCapture(sender.tab?.id ?? null);
        return;
      case 'PIPELINE_STATUS':
        broadcastStatus(setStatus(msg.status));
        return;
      default:
        return;
    }
  });

  onTabMessage((msg) => {
    if (msg.kind !== 'CAPTURE_STATE') return;
    if (!msg.ok) {
      broadcastStatus(setStatus({ state: 'error', error: msg.reason ?? 'Capture failed' }));
    }
  });
});

async function handleToggle(on: boolean): Promise<void> {
  const settings = await patchSettings({ enabled: on });
  const tab = await getActiveTab();

  if (!on) {
    await sendControl({ kind: 'STOP_PIPELINE' }).catch(() => undefined);
    if (tab?.id) await sendToTab(tab.id, { kind: 'STOP_CAPTURE' }).catch(() => undefined);
    broadcastStatus(resetStatus());
    return;
  }

  await ensurePipeline(settings, tab?.id ?? null);
  if (tab?.id) await sendToTabWithInjection(tab.id, { kind: 'START_CAPTURE' });
}

async function handleRequestCapture(tabId: number | null): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled || !tabId) return;
  await ensurePipeline(settings, tabId);
  await sendToTabWithInjection(tabId, { kind: 'START_CAPTURE' }).catch((error) => {
    console.warn('[VoxFlow][SW] request capture failed:', reportError(error));
  });
}

async function ensurePipeline(settings: Settings, tabId: number | null): Promise<void> {
  const streamId = tabId ? await getTabAudioStreamId(tabId) : null;
  await ensureOffscreen();
  await sendControl({ kind: 'START_PIPELINE', settings, tabId, streamId });
}

function ensureOffscreen(): Promise<void> {
  if (!ensureOffscreenLock) {
    ensureOffscreenLock = ensureOffscreenInner().finally(() => {
      ensureOffscreenLock = null;
    });
  }
  return ensureOffscreenLock;
}

async function ensureOffscreenInner(): Promise<void> {
  const deadline = Date.now() + OFFSCREEN_READY_TIMEOUT_MS;

  if (await chrome.offscreen.hasDocument()) {
    if (await pingReady()) return;
    if (await waitForReady(deadline)) return;
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL(OFFSCREEN_URL),
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'VoxFlow keeps the local audio capture pipeline and translated audio playback alive.',
  });

  if (!(await waitForReady(deadline))) {
    throw new Error('Offscreen document did not become ready in time');
  }
}

function pingReady(): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      resolve(ok);
    };
    const listener = (msg: unknown) => {
      if (msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'OFFSCREEN_READY') finish(true);
    };
    const timer = setTimeout(() => finish(false), PING_TIMEOUT_MS);
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage({ kind: 'PING_READY' }).catch(() => finish(false));
  });
}

async function waitForReady(deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (await pingReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return false;
}

async function sendToTabWithInjection(tabId: number, msg: TabMessage): Promise<unknown> {
  try {
    return await sendToTab(tabId, msg);
  } catch (error) {
    const detail = reportError(error);
    if (!/receiving end does not exist/i.test(detail)) throw error;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_PATH],
      injectImmediately: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    return sendToTab(tabId, msg);
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

function getTabAudioStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const error = chrome.runtime.lastError;
      if (error || !streamId) {
        reject(new Error(error?.message ?? 'Unable to create tab audio stream id'));
        return;
      }
      resolve(streamId);
    });
  });
}

function broadcastStatus(status: RuntimeStatus): void {
  chrome.runtime.sendMessage({ kind: 'STATUS', status }).catch(() => undefined);
}
