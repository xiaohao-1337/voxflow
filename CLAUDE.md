# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VoxFlow is a local-first real-time web video voice translation system. It captures audio from web videos, streams it to a local AI server for ASR + translation, and plays back synthesized TTS audio synchronized with the video.

```
┌─────────────────────────────────────┐          ┌──────────────────────────┐
│        Chrome MV3 Extension         │          │     Local AI Server      │
│                                     │          │                          │
│  Content Script (Video capture)     │          │  VAD Segmenter           │
│       ↓                             │          │       ↓                  │
│  AudioWorklet (16kHz downsample)    │──(WS)───▶│  ASR Engine (FunASR)     │
│       ↓                             │          │       ↓                  │
│  Offscreen Document (WS client)     │◀──(WS)───│  MT Engine (NLLB/CTranslate2) │
│       ↓                             │          │       ↓                  │
│  Web Audio API Player (Sync TTS)    │          │  TTS Engine (Coqui/Silero) │
└─────────────────────────────────────┘          └──────────────────────────┘
```

---

## Commands

### Extension (Node/TS/WXT Workspace)

```bash
cd apps/extension
npm install
npm run dev           # Start Chrome dev mode
npm run dev:firefox   # Start Firefox dev mode
npm run compile       # Typecheck: wxt prepare && tsc --noEmit
npm run build         # Build for production
npm run zip           # Package as .zip
```

### Local AI Server (Python)

```bash
cd apps/local-ai-server

# First-time setup
/opt/homebrew/bin/python3.11 -m venv .venv
.venv/bin/python -m pip install torch torchaudio funasr modelscope

# Start server
.venv/bin/python -m src.main --host 127.0.0.1 --port 8765

# Test with manual audio feed
.venv/bin/python scripts/manual_feed.py \
  --host 127.0.0.1 --port 8765 \
  --wav tmp/hello.wav --source-lang en

# Real-time client (WebSocket test tool)
.venv/bin/python scripts/realtime_client.py --help

# Download translation models
.venv/bin/python scripts/download_mt.py --model nllb-200-600m
```

### Tests

```bash
cd apps/local-ai-server
.venv/bin/python -m pytest tests/ -v
```

---

## Project Structure

```
voxflow/
├── apps/
│   ├── extension/           # Chrome Extension (WXT + TS + React)
│   │   └── src/
│   │       ├── core/        # Engine client, protocol, subtitle overlay
│   │       ├── entrypoints/ # content.ts, offscreen, options, popup
│   │       └── messaging/   # Bridge for communication
│   │
│   └── local-ai-server/     # Python ASGI server
│       ├── src/
│       │   ├── main.py           # FastAPI entry point
│       │   ├── config.py         # Configuration
│       │   ├── pipeline/         # Processing pipelines
│       │   │   ├── vad_segmenter.py
│       │   │   ├── asr_pipeline.py
│       │   │   ├── translation_pipeline.py
│       │   │   └── tts_pipeline.py
│       │   ├── providers/        # Model implementations
│       │   │   ├── asr/          # FunASR engine
│       │   │   ├── mt/           # MT engines (CTranslate2, Argos, LibreTranslate)
│       │   │   └── tts/          # TTS engines
│       │   ├── utils/            # Logging, audio, timestamps
│       │   └── ws/               # WebSocket gateway and session
│       ├── scripts/              # CLI tools
│       └── tests/                # Pytest tests
│
├── packages/
│   ├── protocol/            # Shared TypeScript types for WS protocol
│   └── audio/               # Browser-compatible audio utilities
│
└── docs/
    ├── local-engine-protocol.md    # WebSocket protocol spec
    ├── performance-optimization.md # Performance tuning guide
    └── *.md                 # Other documentation
```

---

## Key Subprojects

### `apps/extension` - Chrome Extension
- **Content Script**: Intercepts video elements, captures audio via Web Audio API
- **AudioWorklet**: Down-samples audio to 16kHz mono PCM
- **Offscreen Document**: Maintains stable WebSocket connection to AI server
- **Subtitle Overlay**: Displays translated subtitles over video

### `apps/local-ai-server` - Python AI Server
- **VAD Segmenter**: FSMN-VAD for voice activity detection and segmentation
- **ASR Pipeline**: FunASR (Paraformer/SenseVoice) for speech-to-text
- **Translation Pipeline**: NLLB via CTranslate2, Argos, or LibreTranslate
- **TTS Pipeline**: Coqui TTS or Silero for text-to-speech
- **WebSocket Gateway**: Manages client sessions and message routing

### `packages/protocol` - Shared Types
- TypeScript types for client-server WebSocket communication
- Message schemas for audio chunks, transcription, translation, TTS

---

## Implementation Conventions

### Code Style
- **TypeScript**: Use strict typing, prefer interfaces over types
- **Python**: Follow PEP 8, use type hints, async/await for I/O
- **Naming**: camelCase for TS/JS, snake_case for Python

### Communication Protocol
- WebSocket messages use JSON for metadata, binary ArrayBuffers for audio
- Message types defined in `@voxflow/protocol`
- Audio format: 16kHz mono PCM16 or Float32

### Security
- Local AI server binds to `127.0.0.1` by default
- No external network exposure in default configuration

### Audio Processing
- Sample rate: 16kHz (required by ASR models)
- Channels: Mono
- Format: PCM16 (signed 16-bit integers) or Float32

---

## Architecture Details

### Processing Pipeline

```
Audio Chunk (16kHz PCM)
    ↓
VAD Segmentation → Voice segments with timestamps
    ↓
ASR (FunASR) → Text transcription with timestamps
    ↓
Translation (NLLB/CTranslate2) → Chinese translation
    ↓
TTS (Coqui/Silero) → Audio buffer
    ↓
Play via Web Audio API (synchronized with original video)
```

### WebSocket Protocol

| Message Type | Direction | Content |
|--------------|-----------|---------|
| `audio_start` | Client→Server | Session configuration |
| `audio_chunk` | Client→Server | Binary PCM audio data |
| `audio_end` | Client→Server | End of audio stream |
| `transcription` | Server→Client | ASR result |
| `translation` | Server→Client | MT result |
| `tts_audio` | Server→Client | Synthesized speech |
| `error` | Server→Client | Error information |

---

## Documentation

- [Local Engine Protocol](./docs/local-engine-protocol.md) - Detailed WebSocket protocol
- [Performance Optimization](./docs/performance-optimization.md) - Latency tuning tips
