"""Per-connection state and protocol handling for the local engine."""

from __future__ import annotations

import base64
import binascii
import struct
from dataclasses import dataclass, field
from typing import Any

from src.config import DEFAULT_ASR_LANGUAGE, DEFAULT_ASR_MODEL
from src.pipeline.translation_pipeline import (
    TranslationFailed,
    TranslationUnavailable,
    translate_to_zh,
)
from src.providers.asr.funasr_engine import (
    FunAsrConfig,
    FunAsrEngine,
    FunAsrUnavailable,
    get_funasr_engine,
)
from src.utils.audio import f32le_stats


PROTOCOL_VERSION = "voxflow.local.v1"
DEFAULT_STAGES = ["asr", "mt"]
MAX_CHUNK_BYTES = 1024 * 1024
MAX_SESSION_DURATION_MS = 120_000
SUPPORTED_MT_SOURCE_LANGUAGES = {"en", "en-us", "en-gb"}
SUPPORTED_MT_TARGET_LANGUAGES = {"zh", "zh-cn", "zh-hans"}


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
    protocol_version: str = PROTOCOL_VERSION
    request_id: str | None = None
    stream_id: str = "default"
    stages: list[str] = field(default_factory=lambda: list(DEFAULT_STAGES))
    emit_intermediates: bool = True
    source_lang: str = "en"
    target_lang: str = "zh"
    sample_rate: int = 16000
    channels: int = 1
    sample_format: str = "f32le"
    stats: AudioStats = field(default_factory=AudioStats)
    finalized: bool = False
    segment_seq: int = 0
    last_audio_seq: int = -1
    audio_buffer: bytearray = field(default_factory=bytearray)
    funasr: FunAsrEngine | None = None
    funasr_error: str | None = None

    def start(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        self.session_id = str(message.get("sessionId") or "manual-session")
        self.protocol_version = str(message.get("v") or PROTOCOL_VERSION)
        self.request_id = str(message["requestId"]) if message.get("requestId") else None
        self.stages = parse_stages(message)

        pipeline = message.get("pipeline") if isinstance(message.get("pipeline"), dict) else {}
        self.emit_intermediates = bool(pipeline.get("emitIntermediates", True))
        audio_input = extract_audio_input(message)
        models = message.get("models") if isinstance(message.get("models"), dict) else {}
        asr_config = models.get("asr") if isinstance(models.get("asr"), dict) else {}
        mt_config = models.get("mt") if isinstance(models.get("mt"), dict) else {}

        self.stream_id = str(audio_input.get("streamId") or message.get("streamId") or "default")
        self.source_lang = str(
            asr_config.get("language")
            or mt_config.get("sourceLang")
            or message.get("sourceLang")
            or "en"
        ).lower()
        self.target_lang = str(
            mt_config.get("targetLang") or message.get("targetLang") or "zh"
        ).lower()
        self.sample_rate = int(audio_input.get("sampleRate") or message.get("sampleRate") or 16000)
        self.channels = int(audio_input.get("channels") or 1)
        self.sample_format = normalize_sample_format(
            str(audio_input.get("sampleFormat") or message.get("format") or "f32le")
        )
        self.stats = AudioStats()
        self.finalized = False
        self.last_audio_seq = -1
        self.audio_buffer = bytearray()
        self.funasr = None
        self.funasr_error = None

        events: list[dict[str, Any]] = [
            {
                "v": PROTOCOL_VERSION,
                "type": "session.started",
                "sessionId": self.session_id,
                "requestId": self.request_id,
                "acceptedStages": self.stages,
                "message": "session accepted",
            }
        ]

        validation_error = self.validate_configuration()
        if validation_error:
            code, detail = validation_error
            events.append(self.error(code, detail, recoverable=False))
            events.append(self.status("error", detail))
            return events

        model = str(asr_config.get("model") or message.get("asrModel") or DEFAULT_ASR_MODEL)
        language = str(
            asr_config.get("language")
            or message.get("asrLanguage")
            or self.source_lang
            or DEFAULT_ASR_LANGUAGE
        )
        try:
            self.funasr = get_funasr_engine(
                FunAsrConfig(
                    model=model,
                    language=language,
                    device=str(asr_config.get("device") or message.get("device") or "cpu"),
                )
            )
        except FunAsrUnavailable as exc:
            self.funasr_error = str(exc)
            events.append(self.error("funasr_unavailable", self.funasr_error, recoverable=False))
            events.append(self.status("error", self.funasr_error, stage="asr"))
            return events

        events.append(self.status("ready", f"FunASR loaded: {model} ({language})", stage="asr"))
        return events

    def validate_configuration(self) -> tuple[str, str] | None:
        if self.protocol_version != PROTOCOL_VERSION:
            return "unsupported_protocol", f"Unsupported protocol version: {self.protocol_version}"
        if not self.session_id:
            return "invalid_session", "sessionId is required"
        if self.sample_rate <= 0 or self.sample_rate > 192_000:
            return "invalid_audio", f"Unsupported sample rate: {self.sample_rate}"
        if self.channels != 1:
            return "invalid_audio", "VoxFlow currently accepts mono audio only"
        if "asr" not in self.stages:
            return "invalid_pipeline", "The asr stage is required before mt or tts"
        if "mt" in self.stages:
            if self.source_lang not in SUPPORTED_MT_SOURCE_LANGUAGES:
                return "unsupported_source_language", "Current local MT model supports English input only"
            if self.target_lang not in SUPPORTED_MT_TARGET_LANGUAGES:
                return "unsupported_target_language", "Current local MT model supports Simplified Chinese output only"
        if "tts" in self.stages:
            return "tts_unavailable", "Local TTS is not implemented yet; use stages asr or asr,mt"
        return None

    def ingest_audio(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        self.validate_audio_envelope(message)
        audio_meta = message["audio"]
        audio_b64 = audio_meta["data"]
        try:
            raw_payload = base64.b64decode(audio_b64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("audio.chunk contains invalid base64 data") from exc

        if not raw_payload:
            raise ValueError("audio.chunk cannot be empty")
        if len(raw_payload) > MAX_CHUNK_BYTES:
            raise ValueError(f"audio.chunk exceeds {MAX_CHUNK_BYTES} bytes")
        declared_bytes = audio_meta.get("byteLength")
        if declared_bytes is not None and int(declared_bytes) != len(raw_payload):
            raise ValueError(
                f"audio.byteLength mismatch: declared {declared_bytes}, decoded {len(raw_payload)}"
            )

        fmt = normalize_sample_format(str(audio_meta.get("sampleFormat") or self.sample_format))
        if fmt != self.sample_format:
            raise ValueError(f"sample format changed within session: {self.sample_format} -> {fmt}")
        sample_rate = int(audio_meta.get("sampleRate") or self.sample_rate)
        if sample_rate != self.sample_rate:
            raise ValueError(f"sample rate changed within session: {self.sample_rate} -> {sample_rate}")
        channels = int(audio_meta.get("channels") or self.channels)
        if channels != self.channels:
            raise ValueError(f"channel count changed within session: {self.channels} -> {channels}")

        payload = normalize_audio_payload(raw_payload, fmt)
        chunk = f32le_stats(payload)
        frame_count = int(chunk["samples"])
        declared_frames = audio_meta.get("frameCount")
        if declared_frames is not None and int(declared_frames) != frame_count:
            raise ValueError(
                f"audio.frameCount mismatch: declared {declared_frames}, decoded {frame_count}"
            )

        next_samples = self.stats.samples + frame_count
        duration_ms = int(next_samples / self.sample_rate * 1000)
        if duration_ms > MAX_SESSION_DURATION_MS:
            raise ValueError(f"session audio exceeds {MAX_SESSION_DURATION_MS}ms")

        self.audio_buffer.extend(payload)
        self.stats.chunks += 1
        self.stats.bytes += len(payload)
        self.stats.samples = next_samples
        self.stats.rms = float(chunk["rms"])
        self.stats.peak = max(self.stats.peak, float(chunk["peak"]))
        self.last_audio_seq = int(message["seq"])

        return [
            {
                "v": PROTOCOL_VERSION,
                "type": "audio.stats",
                "sessionId": self.session_id,
                "requestId": message.get("requestId"),
                "streamId": message.get("streamId") or self.stream_id,
                "chunks": self.stats.chunks,
                "bytes": self.stats.bytes,
                "samples": self.stats.samples,
                "durationMs": duration_ms,
                "rms": round(self.stats.rms, 6),
                "peak": round(self.stats.peak, 6),
            }
        ]

    def validate_audio_envelope(self, message: dict[str, Any]) -> None:
        if self.finalized:
            raise ValueError("session is already finalized")
        if not self.session_id:
            raise ValueError("session.start must be sent before audio.chunk")
        if str(message.get("sessionId") or "") != self.session_id:
            raise ValueError("audio.chunk sessionId does not match the active session")
        if str(message.get("streamId") or self.stream_id) != self.stream_id:
            raise ValueError("audio.chunk streamId does not match the active stream")
        seq = message.get("seq")
        if not isinstance(seq, int) or isinstance(seq, bool):
            raise ValueError("audio.chunk seq must be an integer")
        if seq != self.last_audio_seq + 1:
            raise ValueError(f"audio.chunk sequence mismatch: expected {self.last_audio_seq + 1}, got {seq}")
        audio_meta = message.get("audio")
        if not isinstance(audio_meta, dict) or not isinstance(audio_meta.get("data"), str):
            raise ValueError("audio.chunk requires audio.data base64 content")
        if audio_meta.get("transport", "json.base64") != "json.base64":
            raise ValueError("audio.chunk only supports json.base64 transport")
        if audio_meta.get("codec", "pcm") != "pcm":
            raise ValueError("audio.chunk only supports PCM audio")

    def end_audio(self, message: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        if message and str(message.get("sessionId") or "") != self.session_id:
            raise ValueError("audio.end sessionId does not match the active session")
        events = self.finalize()
        events.append(
            self.status(
                "stopped",
                "stopped",
                request_id=(message or {}).get("requestId"),
            )
        )
        return events

    def stop(self) -> list[dict[str, Any]]:
        return self.end_audio()

    def cancel(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        self.finalized = True
        self.audio_buffer.clear()
        return [
            self.status(
                "stopped",
                str(message.get("reason") or "cancelled"),
                request_id=message.get("requestId"),
            )
        ]

    def finalize(self) -> list[dict[str, Any]]:
        if self.finalized:
            return []
        self.finalized = True
        self.segment_seq += 1
        segment_id = f"seg-{self.segment_seq:04d}"
        duration_ms = int(self.stats.samples / self.sample_rate * 1000)

        if not self.audio_buffer:
            return [self.error("empty_audio", "No audio was received", recoverable=False)]
        if not self.funasr:
            return [
                self.error(
                    "funasr_unavailable",
                    self.funasr_error or "FunASR is unavailable",
                    recoverable=False,
                )
            ]

        try:
            source_text = self.funasr.transcribe_f32le(bytes(self.audio_buffer), self.sample_rate).strip()
        except Exception as exc:
            return [self.error("asr_failed", f"FunASR inference failed: {exc}", recoverable=False)]
        if not source_text:
            return [self.error("asr_empty", "FunASR returned empty text", recoverable=True)]

        events: list[dict[str, Any]] = []
        if self.emit_intermediates or self.stages == ["asr"]:
            events.append(
                {
                    "v": PROTOCOL_VERSION,
                    "type": "asr.final",
                    "sessionId": self.session_id,
                    "segmentId": segment_id,
                    "text": source_text,
                    "language": self.source_lang,
                    "startMs": 0,
                    "endMs": duration_ms,
                }
            )

        translated = ""
        if "mt" in self.stages:
            try:
                translated = translate_to_zh(source_text)
            except TranslationUnavailable as exc:
                events.append(self.error("mt_unavailable", str(exc), recoverable=False))
                return events
            except TranslationFailed as exc:
                events.append(self.error("mt_failed", str(exc), recoverable=True))
                return events
            if self.emit_intermediates or last_stage(self.stages) == "mt":
                events.append(
                    {
                        "v": PROTOCOL_VERSION,
                        "type": "mt.final",
                        "sessionId": self.session_id,
                        "segmentId": segment_id,
                        "source": {"text": source_text, "language": self.source_lang},
                        "target": {"text": translated, "language": self.target_lang},
                        "startMs": 0,
                        "endMs": duration_ms,
                    }
                )

        events.append(self.result_final(segment_id, source_text, translated, duration_ms))
        return events

    def result_final(
        self,
        segment_id: str,
        source_text: str,
        translated: str,
        duration_ms: int,
    ) -> dict[str, Any]:
        base: dict[str, Any] = {
            "v": PROTOCOL_VERSION,
            "type": "result.final",
            "sessionId": self.session_id,
            "segmentId": segment_id,
            "startMs": 0,
            "endMs": duration_ms,
        }
        if last_stage(self.stages) == "mt":
            return {
                **base,
                "kind": "text",
                "sourceText": source_text,
                "translatedText": translated,
                "sourceLang": self.source_lang,
                "targetLang": self.target_lang,
            }
        return {**base, "kind": "asr", "text": source_text}

    def status(
        self,
        state: str,
        message: str,
        *,
        stage: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        event: dict[str, Any] = {
            "v": PROTOCOL_VERSION,
            "type": "engine.status",
            "sessionId": self.session_id,
            "requestId": request_id if request_id is not None else self.request_id,
            "state": state,
            "message": message,
        }
        if stage:
            event["stage"] = stage
        return event

    def error(self, code: str, message: str, recoverable: bool = True) -> dict[str, Any]:
        return {
            "v": PROTOCOL_VERSION,
            "type": "error",
            "sessionId": self.session_id,
            "requestId": self.request_id,
            "code": code,
            "message": message,
            "recoverable": recoverable,
        }


def extract_audio_input(message: dict[str, Any]) -> dict[str, Any]:
    input_config = message.get("input")
    if not isinstance(input_config, dict):
        return {}
    audio = input_config.get("audio")
    return audio if isinstance(audio, dict) else {}


def parse_stages(message: dict[str, Any]) -> list[str]:
    pipeline = message.get("pipeline") if isinstance(message.get("pipeline"), dict) else {}
    stages = pipeline.get("stages")
    if isinstance(stages, list) and stages:
        parsed = [str(stage) for stage in stages]
    else:
        parsed = infer_legacy_stages(message)
    allowed = {"asr", "mt", "tts"}
    parsed = [stage for stage in parsed if stage in allowed]
    if not parsed:
        parsed = list(DEFAULT_STAGES)
    if "tts" in parsed and "mt" not in parsed:
        parsed.insert(parsed.index("tts"), "mt")
    if ("mt" in parsed or "tts" in parsed) and "asr" not in parsed:
        parsed.insert(0, "asr")
    return dedupe_stages(parsed)


def infer_legacy_stages(message: dict[str, Any]) -> list[str]:
    stages = ["asr"]
    if message.get("mtProvider") or message.get("targetLang"):
        stages.append("mt")
    if message.get("ttsProvider") and message.get("enableTts", False):
        stages.append("tts")
    return stages


def dedupe_stages(stages: list[str]) -> list[str]:
    result: list[str] = []
    for stage in stages:
        if stage not in result:
            result.append(stage)
    return result


def last_stage(stages: list[str]) -> str:
    return stages[-1] if stages else "asr"


def normalize_sample_format(fmt: str) -> str:
    normalized = fmt.lower()
    if normalized in {"f32le", "float32le"}:
        return "f32le"
    if normalized in {"pcm16", "pcm16le", "s16le"}:
        return "pcm16le"
    raise ValueError(f"unsupported audio sample format: {fmt}")


def normalize_audio_payload(payload: bytes, fmt: str) -> bytes:
    normalized = normalize_sample_format(fmt)
    if normalized == "f32le":
        if len(payload) % 4 != 0:
            raise ValueError("f32le audio byte length must be divisible by 4")
        return payload
    if len(payload) % 2 != 0:
        raise ValueError("pcm16le audio byte length must be divisible by 2")
    values = struct.unpack("<" + "h" * (len(payload) // 2), payload)
    out = bytearray()
    for value in values:
        out.extend(struct.pack("<f", max(-1.0, min(1.0, value / 32768.0))))
    return bytes(out)
