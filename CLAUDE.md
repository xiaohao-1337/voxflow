# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Extension (Node/TS/WXT Workspace)
- **Install Dependencies**: `npm install`
- **Start Extension Dev Mode**: `npm run dev`
- **Start Firefox Dev Mode**: `npm run dev:firefox`
- **Typecheck & Compile**: `npm run compile` (runs `wxt prepare && tsc --noEmit`)
- **Build Extension**: `npm run build`
- **Package Zip**: `npm run zip`

### Local AI Server (Python)
- **Set up Environment**:
  ```bash
  cd apps/local-ai-server
  /opt/homebrew/bin/python3.11 -m venv .venv
  .venv/bin/python -m pip install torch torchaudio funasr modelscope
  ```
- **Start AI Server**:
  ```bash
  cd apps/local-ai-server
  .venv/bin/python -m src.main --host 127.0.0.1 --port 8765
  ```
- **Manual Test Feed**: feeds audio to the running WebSocket server:
  ```bash
  cd apps/local-ai-server
  .venv/bin/python scripts/manual_feed.py --host 127.0.0.1 --port 8765 --wav tmp/hello.wav --source-lang en
  ```

---

## High-Level Architecture

VoxFlow is a local-first real-time web video voice translation system.

```
+-----------------------------------+            +-------------------------+
|        Chrome MV3 Extension       |            |     Local AI Server     |
|  - Content Script (Video capture) |            |                         |
|  - AudioWorklet (Down-sampling)  | --(WS)---->|  - FSMN-VAD / Segmenter |
|  - Offscreen.html (WS client)     |<--(WS)-----|  - FunASR Engine (ASR)  |
|  - Web Audio API Player (Sync)    |            |  - Translation & TTS    |
+-----------------------------------+            +-------------------------+
```

### 1. Key Subprojects
- **`apps/extension`**: Chrome Extension built with WXT + TS + React.
  - *Audio capture*: Content script taps video elements to intercept audio via Web Audio API. AudioWorklet down-samples to 16kHz mono.
  - *Offscreen Document*: Stably hosts the WebSocket connection to the AI local server and coordinates TTS audio queue playback.
- **`apps/local-ai-server`**: Python 3.10+ ASGI service using FastAPI WebSockets.
  - Employs FSMN-VAD to segment incoming chunks, Paraformer/SenseVoiceSmall via Alibaba’s FunASR for speech-to-text, and local translation/TTS models.
- **`packages/protocol`**: Shared TypeScript types for typing Client-to-Server communication.
- **`packages/audio`**: Shared browser-compatible audio parsing and resample utilities.

### 2. Implementation Conventions
- **Code Style**: Match the local environment styles. Use TypeScript for all extension and packages code, and standard Python conventions for the local AI server.
- **Communication Protocol**: WebSocket data packets must strictly match schemas defined in `@voxflow/protocol`. Audio chunks are streamed as binary array buffers containing Float32 or PCM16 samples.
- **Security**: Local AI server defaults to listening on `127.0.0.1`.
