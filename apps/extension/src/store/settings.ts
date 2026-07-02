import { DEFAULT_SETTINGS, type Settings } from '../core/types';

const KEY = 'voxflow:settings';

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(raw[KEY] as Partial<Settings> | undefined) };
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await setSettings(next);
  return next;
}

export function onSettingsChanged(handler: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[KEY]) return;
    handler({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
