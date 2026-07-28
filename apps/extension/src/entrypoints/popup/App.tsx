import { useEffect, useMemo, useState } from 'react';
import type { RuntimeStatus, Settings } from '../../core/types';
import { DEFAULT_SETTINGS, DEFAULT_STATUS } from '../../core/types';
import { onControlMessage, sendControl } from '../../messaging/bridge';
import { formatBytes, formatMs } from '../../lib/utils';

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<RuntimeStatus>(DEFAULT_STATUS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void sendControl({ kind: 'GET_SETTINGS' }).then((value) => setSettings(value as Settings));
    void sendControl({ kind: 'GET_STATUS' }).then((value) => setStatus(value as RuntimeStatus));
    return onControlMessage((msg) => {
      if (msg.kind === 'STATUS') setStatus(msg.status);
    });
  }, []);

  const captureText = useMemo(() => {
    if (status.capture.chunks === 0) return 'No audio captured yet';
    return `${status.capture.chunks} chunks / ${formatBytes(status.capture.bytes)} / ${formatMs(status.capture.durationMs)}`;
  }, [status.capture]);

  async function toggle(): Promise<void> {
    setBusy(true);
    try {
      await sendControl({ kind: 'TOGGLE', on: !settings.enabled });
      const next = await sendControl({ kind: 'GET_SETTINGS' });
      setSettings(next as Settings);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Local-first voice translation</p>
          <h1>VoxFlow</h1>
        </div>
        <button className={settings.enabled ? 'toggle on' : 'toggle'} disabled={busy} onClick={toggle}>
          {settings.enabled ? 'Stop' : 'Start'}
        </button>
      </section>

      <section className="status-card">
        <div className="row">
          <span>State</span>
          <strong>{status.state}</strong>
        </div>
        <div className="row">
          <span>Audio</span>
          <strong>{captureText}</strong>
        </div>
        <div className="meter">
          <div style={{ width: `${Math.min(100, status.capture.peak * 120)}%` }} />
        </div>
        <div className="grid">
          <div>
            <small>RMS</small>
            <b>{status.capture.rms.toFixed(4)}</b>
          </div>
          <div>
            <small>Peak</small>
            <b>{status.capture.peak.toFixed(4)}</b>
          </div>
          <div>
            <small>Rate</small>
            <b>{status.capture.sampleRate} Hz</b>
          </div>
        </div>
      </section>

      <section className="note">
        <strong>Current milestone:</strong> Local FunASR recognition and English-to-Chinese text translation. Translated voice playback is planned.
      </section>

      {status.error && <section className="error">{status.error}</section>}
    </main>
  );
}
