# voxflow-local-engine

Local AI engine for the VoxFlow Chrome extension.

Current milestone:

- stdlib WebSocket gateway on `ws://127.0.0.1:8765/ws`
- FunASR local ASR with `iic/SenseVoiceSmall`
- placeholder local Chinese translation for known smoke-test phrases
- placeholder PCM silence TTS event

Setup:

```bash
/opt/homebrew/bin/python3.11 -m venv .venv
.venv/bin/python -m pip install torch torchaudio funasr modelscope
```

Run the server:

```bash
.venv/bin/python -m src.main --host 127.0.0.1 --port 8765
```

Feed a WAV file:

```bash
.venv/bin/python scripts/manual_feed.py --host 127.0.0.1 --port 8765 --wav tmp/hello.wav --source-lang en
```

The first FunASR run downloads the selected model into the local ModelScope
cache, so it can take several minutes.
