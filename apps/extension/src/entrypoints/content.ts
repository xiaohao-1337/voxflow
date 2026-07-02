import { startAudioCapture, type AudioCaptureHandle } from '../core/audio/audio-capture';
import { findMainVideo } from '../core/audio/media';
import { SubtitleOverlay } from '../core/subtitles/subtitle-overlay';
import { connectPcmPort, onTabMessage, sendControl } from '../messaging/bridge';
import type { PcmPort } from '../messaging/bridge';
import { PORT } from '../messaging/protocol';
import { getSettings, onSettingsChanged } from '../store/settings';
import { reportError } from '../lib/utils';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let handle: AudioCaptureHandle | null = null;
    let port: PcmPort | null = null;
    let overlay: SubtitleOverlay | null = null;
    let startPromise: Promise<void> | null = null;
    let seq = 0;

    onTabMessage((msg) => {
      if (msg.kind === 'START_CAPTURE') void start();
      if (msg.kind === 'STOP_CAPTURE') cleanup();
    });

    onSettingsChanged((settings) => {
      if (settings.enabled) requestCapture();
      else cleanup();
    });

    void getSettings().then((settings) => {
      if (settings.enabled) requestCapture();
    });

    function requestCapture(): void {
      sendControl({ kind: 'REQUEST_CAPTURE' }).catch(() => undefined);
    }

    async function start(): Promise<void> {
      if (startPromise) return startPromise;
      startPromise = startInner().finally(() => {
        startPromise = null;
      });
      return startPromise;
    }

    async function startInner(): Promise<void> {
      if (handle) return;
      const video = findMainVideo();
      if (!video) {
        sendCaptureState(false, 'No video element was found on this page.');
        return;
      }

      overlay = new SubtitleOverlay();
      overlay.show();
      overlay.update({
        original: '',
        translated: '',
        hint: 'Capturing page audio. Original audio is intercepted by Web Audio.',
        partial: true,
      });

      port = connectPcmPort(PORT.PCM);
      port.on((msg) => {
        if (msg.kind === 'SUBTITLE') overlay?.update(msg.payload);
      });
      port.onDisconnect(() => {
        handle?.stop();
        handle = null;
        port = null;
      });
      safePost({ kind: 'READY', tabId: 0, url: location.href });

      try {
        handle = await startAudioCapture(video, {
          onPcm(frame) {
            safePost({
              kind: 'PCM',
              seq: seq++,
              samples: frame.samples.buffer as ArrayBuffer,
              sampleRate: frame.sampleRate,
              timestamp: performance.now(),
              videoTime: video.currentTime,
              rms: frame.rms,
              peak: frame.peak,
            });
          },
          onVideoTime(state) {
            safePost({ kind: 'VIDEO_TIME', ...state });
          },
        });
        sendCaptureState(true);
      } catch (error) {
        const detail = reportError(error);
        sendCaptureState(false, `Audio capture failed: ${detail}`);
        overlay.update({ original: '', translated: '', hint: `Capture failed: ${detail}`, partial: true });
        cleanup(false);
      }
    }

    function cleanup(removeOverlay = true): void {
      startPromise = null;
      handle?.stop();
      handle = null;
      try {
        port?.raw.disconnect();
      } catch {
        // Ignore a disconnected port.
      }
      port = null;
      seq = 0;
      if (removeOverlay) {
        overlay?.remove();
        overlay = null;
      }
    }

    function safePost(message: Parameters<PcmPort['post']>[0]): void {
      try {
        port?.post(message);
      } catch (error) {
        console.warn('[VoxFlow][Content] post failed:', reportError(error));
      }
    }

    function sendCaptureState(ok: boolean, reason?: string): void {
      chrome.runtime.sendMessage({ kind: 'CAPTURE_STATE', ok, reason }).catch(() => undefined);
    }
  },
});
