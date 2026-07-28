import type { SubtitlePayload } from '../types';

const STYLE_ID = 'voxflow-subtitle-style';
const ROOT_ID = 'voxflow-subtitle-root';

export class SubtitleOverlay {
  private root: HTMLDivElement | null = null;
  private audioUrl: string | null = null;

  show(): void {
    if (this.root) return;
    injectStyles();
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="vf-card">
        <div class="vf-brand">VoxFlow</div>
        <div class="vf-original"></div>
        <div class="vf-translated"></div>
        <div class="vf-hint">Waiting for audio...</div>
        <div class="vf-audio-container">
          <audio class="vf-audio" controls></audio>
          <a class="vf-download" download="voxflow-capture.wav">Download WAV</a>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);
    this.root = root;
  }

  update(payload: SubtitlePayload): void {
    this.show();
    const original = this.root?.querySelector<HTMLElement>('.vf-original');
    const translated = this.root?.querySelector<HTMLElement>('.vf-translated');
    const hint = this.root?.querySelector<HTMLElement>('.vf-hint');
    if (original) original.textContent = payload.original;
    if (translated) translated.textContent = payload.translated;
    if (hint) hint.textContent = payload.hint;

    const container = this.root?.querySelector<HTMLElement>('.vf-audio-container');
    if (container) container.style.display = 'none';
  }

  updateAudio(blob: Blob): void {
    this.show();
    const container = this.root?.querySelector<HTMLElement>('.vf-audio-container');
    const audio = this.root?.querySelector<HTMLAudioElement>('.vf-audio');
    const download = this.root?.querySelector<HTMLAnchorElement>('.vf-download');
    if (container && audio && download) {
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      const url = URL.createObjectURL(blob);
      this.audioUrl = url;
      audio.src = url;
      download.href = url;
      container.style.display = 'flex';

      const hint = this.root?.querySelector<HTMLElement>('.vf-hint');
      if (hint) hint.textContent = 'Audio capture stopped. You can play or download the captured audio below.';
    }
  }

  remove(): void {
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = null;
    this.root?.remove();
    this.root = null;
  }
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: fixed;
      left: 50%;
      bottom: 7vh;
      transform: translateX(-50%);
      z-index: 2147483647;
      width: min(760px, 86vw);
      pointer-events: none;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    #${ROOT_ID} .vf-card {
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(13, 18, 28, .88), rgba(10, 72, 80, .78));
      box-shadow: 0 18px 50px rgba(0,0,0,.38);
      color: white;
      padding: 12px 18px 14px;
      text-align: center;
      backdrop-filter: blur(14px);
    }
    #${ROOT_ID} .vf-brand {
      font-size: 11px;
      letter-spacing: .18em;
      text-transform: uppercase;
      opacity: .68;
      margin-bottom: 4px;
    }
    #${ROOT_ID} .vf-original {
      min-height: 20px;
      font-size: 14px;
      opacity: .84;
    }
    #${ROOT_ID} .vf-translated {
      min-height: 26px;
      margin-top: 2px;
      font-size: 20px;
      font-weight: 700;
    }
    #${ROOT_ID} .vf-hint {
      margin-top: 5px;
      font-size: 12px;
      opacity: .66;
    }
    #${ROOT_ID} .vf-audio-container {
      display: none;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: auto;
    }
    #${ROOT_ID} .vf-audio {
      width: 100%;
      height: 36px;
      outline: none;
      pointer-events: auto;
    }
    #${ROOT_ID} .vf-download {
      display: inline-flex;
      align-items: center;
      color: #00e5ff;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      padding: 6px 16px;
      border: 1px solid rgba(0, 229, 255, 0.4);
      border-radius: 20px;
      background: rgba(0, 229, 255, 0.05);
      transition: all 0.2s ease;
      cursor: pointer;
      pointer-events: auto;
    }
    #${ROOT_ID} .vf-download:hover {
      background: rgba(0, 229, 255, 0.15);
      border-color: #00e5ff;
      box-shadow: 0 0 8px rgba(0, 229, 255, 0.3);
    }
  `;
  document.documentElement.appendChild(style);
}
