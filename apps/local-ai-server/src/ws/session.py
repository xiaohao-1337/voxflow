"""Session state for the local-engine WebSocket smoke test."""

from __future__ import annotations

import base64
from dataclasses import dataclass, field

from src.config import DEFAULT_ASR_LANGUAGE, DEFAULT_ASR_MODEL
from src.providers.asr.funasr_engine import FunAsrConfig, FunAsrEngine, FunAsrUnavailable, get_funasr_engine
from src.pipeline.translation_pipeline import translate_to_zh
from src.utils.audio import f32le_stats, pcm16_silence


@dataclass
class AudioStats:
    chunks: int = 0
    bytes: int = 0
    samples: int = 0
    rms: float = 0.0
    peak: float = 0.0


@dataclass
class LocalEngineSession:
    session_id: str = ""
    source_lang: str = "en"
    target_lang: str = "zh"
    sample_rate: int = 16000
    stats: AudioStats = field(default_factory=AudioStats)
    finalized: bool = False
    audio_buffer: bytearray = field(default_factory=bytearray)
    funasr: FunAsrEngine | None = None
    funasr_error: str | None = None

    def start(self, message: dict) -> list[dict]:
        self.session_id = str(message.get("sessionId") or "manual-session")
        self.source_lang = str(message.get("sourceLang") or "en")
        self.target_lang = str(message.get("targetLang") or "zh")
        self.sample_rate = int(message.get("sampleRate") or 16000)
        self.stats = AudioStats()
        self.finalized = False
        self.audio_buffer = bytearray()
        self.funasr = None
        self.funasr_error = None
        model = str(message.get("asrModel") or DEFAULT_ASR_MODEL)
        language = str(message.get("asrLanguage") or self.source_lang or DEFAULT_ASR_LANGUAGE)
        try:
            self.funasr = get_funasr_engine(
                FunAsrConfig(
                    model=model,
                    language=language,
                    device=str(message.get("device") or "cpu"),
                )
            )
            self.funasr_error = None
            engine_message = f"FunASR loaded: {model} ({language})"
        except FunAsrUnavailable as exc:
            self.funasr = None
            self.funasr_error = str(exc)
            engine_message = self.funasr_error
        return [
            {
                "type": "engine.status",
                "sessionId": self.session_id,
                "state": "ready",
                "message": engine_message,
            }
        ]

    def ingest_audio(self, message: dict) -> list[dict]:
        audio_b64 = message.get("audio")
        if not isinstance(audio_b64, str):
            raise ValueError("audio.chunk requires base64 string field: audio")
        payload = base64.b64decode(audio_b64)
        fmt = str(message.get("format") or "f32le")
        if fmt != "f32le":
            raise ValueError(f"unsupported smoke-test audio format: {fmt}")

        chunk = f32le_stats(payload)
        self.audio_buffer.extend(payload)
        self.stats.chunks += 1
        self.stats.bytes += len(payload)
        self.stats.samples += int(chunk["samples"])
        self.stats.rms = float(chunk["rms"])
        self.stats.peak = max(self.stats.peak, float(chunk["peak"]))

        duration_ms = int(self.stats.samples / self.sample_rate * 1000)
        events: list[dict] = [
            {
                "type": "audio.stats",
                "sessionId": self.session_id,
                "chunks": self.stats.chunks,
                "bytes": self.stats.bytes,
                "samples": self.stats.samples,
                "durationMs": duration_ms,
                "rms": round(self.stats.rms, 6),
                "peak": round(self.stats.peak, 6),
            }
        ]

        return events

    def stop(self) -> list[dict]:
        events = self.finalize()
        events.append(
            {
                "type": "engine.status",
                "sessionId": self.session_id,
                "state": "ready",
                "message": "stopped",
            }
        )
        return events

    def finalize(self) -> list[dict]:
        if self.finalized:
            return []
        self.finalized = True
        duration_ms = int(self.stats.samples / self.sample_rate * 1000)
        events: list[dict] = []
        if self.funasr and self.audio_buffer:
            source_text = self.funasr.transcribe_f32le(bytes(self.audio_buffer), self.sample_rate)
        else:
            source_text = "smoke test audio received"
            events.append(
                {
                    "type": "error",
                    "sessionId": self.session_id,
                    "code": "funasr_unavailable",
                    "message": self.funasr_error or "FunASR is unavailable",
                }
            )
        translated = translate_to_zh(source_text)
        tts_audio = base64.b64encode(pcm16_silence(300, self.sample_rate)).decode("ascii")
        events.extend(
            [
                {
                    "type": "asr.final",
                    "sessionId": self.session_id,
                    "text": source_text,
                    "startMs": 0,
                    "endMs": duration_ms,
                },
                {
                    "type": "translation.final",
                    "sessionId": self.session_id,
                    "sourceText": source_text,
                    "translatedText": translated,
                    "sourceStartMs": 0,
                    "sourceEndMs": duration_ms,
                },
                {
                    "type": "tts.audio",
                    "sessionId": self.session_id,
                    "seq": 1,
                    "text": translated,
                    "audioFormat": "pcm16",
                    "sampleRate": self.sample_rate,
                    "sourceStartMs": 0,
                    "sourceEndMs": duration_ms,
                    "audio": tts_audio,
                },
            ]
        )
        return events
