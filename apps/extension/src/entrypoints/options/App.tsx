import { useEffect, useState } from 'react';
import type { Settings } from '../../core/types';
import { DEFAULT_SETTINGS } from '../../core/types';
import { sendControl } from '../../messaging/bridge';

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void sendControl({ kind: 'GET_SETTINGS' }).then((value) => setSettings(value as Settings));
  }, []);

  async function update(patch: Partial<Settings>): Promise<void> {
    const next = (await sendControl({ kind: 'UPDATE_SETTINGS', patch })) as Settings;
    setSettings(next);
  }

  return (
    <main>
      <h1>VoxFlow Settings</h1>
      <label>
        Local engine URL
        <input value={settings.localEngineUrl} onChange={(event) => void update({ localEngineUrl: event.target.value })} />
      </label>
      <label>
        Source language
        <select value={settings.sourceLang} onChange={(event) => void update({ sourceLang: event.target.value as Settings['sourceLang'] })}>
          <option value="en">English</option>
          <option value="auto">Auto</option>
          <option value="zh">Chinese</option>
        </select>
      </label>
      <label>
        Target language
        <select value={settings.targetLang} onChange={(event) => void update({ targetLang: event.target.value as Settings['targetLang'] })}>
          <option value="zh">Chinese</option>
          <option value="en">English</option>
        </select>
      </label>
      <p>Local AI engine implementation is intentionally placeholder-only in this milestone.</p>
    </main>
  );
}
