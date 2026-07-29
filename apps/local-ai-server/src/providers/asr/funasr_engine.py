"""FunASR provider adapter.

This module is intentionally imported lazily by the session pipeline so the
smoke-test server can still run on machines where FunASR/Torch are not
installed yet.
"""

from __future__ import annotations

import tempfile
import threading
import wave
from dataclasses import dataclass
from pathlib import Path
import re

from src.config import DEFAULT_ASR_LANGUAGE, DEFAULT_ASR_MODEL


class FunAsrUnavailable(RuntimeError):
    """Raised when FunASR is not installed or cannot be initialized."""


@dataclass
class FunAsrConfig:
    model: str = DEFAULT_ASR_MODEL
    language: str = DEFAULT_ASR_LANGUAGE
    vad_model: str | None = None
    punc_model: str | None = None
    device: str = "cpu"
    use_itn: bool = True
    merge_vad: bool = True
    merge_length_s: int = 15


_ENGINE_CACHE: dict[tuple[str, str, str], "FunAsrEngine"] = {}
_ENGINE_CACHE_LOCK = threading.Lock()


def get_funasr_engine(config: FunAsrConfig) -> "FunAsrEngine":
    key = (config.model, config.language, config.device)
    engine = _ENGINE_CACHE.get(key)
    if engine is not None:
        return engine
    with _ENGINE_CACHE_LOCK:
        engine = _ENGINE_CACHE.get(key)
        if engine is None:
            engine = FunAsrEngine(config)
            _ENGINE_CACHE[key] = engine
    return engine


def has_loaded_funasr_engine() -> bool:
    return bool(_ENGINE_CACHE)


class FunAsrEngine:
    def __init__(self, config: FunAsrConfig | None = None) -> None:
        self.config = config or FunAsrConfig()
        try:
            from funasr import AutoModel  # type: ignore
        except Exception as exc:  # pragma: no cover - depends on local env
            raise FunAsrUnavailable(
                "FunASR is not installed. Install a supported Python/Torch/FunASR environment first."
            ) from exc

        kwargs: dict[str, object] = {
            "model": self.config.model,
            "device": self.config.device,
            "disable_update": True,
        }
        if self.config.vad_model:
            kwargs["vad_model"] = self.config.vad_model
        if self.config.punc_model:
            kwargs["punc_model"] = self.config.punc_model
        self._model = AutoModel(**kwargs)

    def transcribe_f32le(self, pcm: bytes, sample_rate: int) -> str:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            path = Path(tmp.name)
        try:
            write_f32le_as_wav(pcm, sample_rate, path)
            kwargs: dict[str, object] = {
                "input": str(path),
                "language": self.config.language,
                "use_itn": self.config.use_itn,
            }
            if self.config.merge_vad:
                kwargs["merge_vad"] = True
                kwargs["merge_length_s"] = self.config.merge_length_s
            result = self._model.generate(**kwargs)
            return extract_text(result)
        finally:
            path.unlink(missing_ok=True)


def write_f32le_as_wav(pcm: bytes, sample_rate: int, path: Path) -> None:
    import array
    import struct

    samples = array.array("f")
    samples.frombytes(pcm)
    if struct.pack("=f", 1.0) != struct.pack("<f", 1.0):
        samples.byteswap()

    pcm16 = bytearray()
    for sample in samples:
        value = max(-1.0, min(1.0, float(sample)))
        integer = int(value * 32767) if value >= 0 else int(value * 32768)
        pcm16.extend(struct.pack("<h", integer))

    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(bytes(pcm16))


def extract_text(result: object) -> str:
    if isinstance(result, list):
        texts: list[str] = []
        for item in result:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                texts.append(item["text"])
            elif isinstance(item, str):
                texts.append(item)
        return clean_text(" ".join(texts))
    if isinstance(result, dict) and isinstance(result.get("text"), str):
        return clean_text(result["text"])
    if isinstance(result, str):
        return clean_text(result)
    return clean_text(str(result))


def clean_text(text: str) -> str:
    return re.sub(r"<\|[^|]+?\|>", "", text).strip()
