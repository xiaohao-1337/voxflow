import type { SubtitlePayload } from '../types';

const STYLE_ID = 'voxflow-subtitle-style';
const ROOT_ID = 'voxflow-subtitle-root';

export class SubtitleOverlay {
  private root: HTMLDivElement | null = null;

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
  }

  remove(): void {
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
  `;
  document.documentElement.appendChild(style);
}
