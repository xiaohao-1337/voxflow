"""Local English-to-Chinese translation backed by a Hugging Face model."""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

from src.config import DEFAULT_MT_MODEL

logger = logging.getLogger(__name__)


class TranslationUnavailable(RuntimeError):
    """Raised when the local translation model cannot be loaded."""


class TranslationFailed(RuntimeError):
    """Raised when local translation inference fails."""


class HuggingFaceTranslationEngine:
    def __init__(self, model_path: str | Path) -> None:
        path = Path(model_path)
        if not path.is_dir():
            raise TranslationUnavailable(f"Local translation model directory does not exist: {path}")

        try:
            import torch
            from transformers import MarianMTModel, MarianTokenizer
        except Exception as exc:
            raise TranslationUnavailable(
                "Translation dependencies are unavailable. Install torch, transformers, and sentencepiece."
            ) from exc

        self.model_path = str(path)
        self._torch = torch
        self._lock = threading.Lock()
        logger.info("Initializing local translation model at %s", self.model_path)
        try:
            self.tokenizer: Any = MarianTokenizer.from_pretrained(self.model_path, local_files_only=True)
            self.model: Any = MarianMTModel.from_pretrained(self.model_path, local_files_only=True)
            self.model.eval()
        except Exception as exc:
            raise TranslationUnavailable(f"Unable to load local translation model at {path}: {exc}") from exc

    def translate(self, text: str) -> str:
        normalized = text.strip()
        if not normalized:
            return ""
        try:
            with self._lock, self._torch.inference_mode():
                inputs = self.tokenizer(normalized, return_tensors="pt", padding=True, truncation=True)
                outputs = self.model.generate(**inputs)
                translated = self.tokenizer.batch_decode(outputs, skip_special_tokens=True)
        except Exception as exc:
            logger.exception("Translation inference failed")
            raise TranslationFailed(f"Local translation inference failed: {exc}") from exc

        result = translated[0].strip() if translated else ""
        if not result:
            raise TranslationFailed("Local translation model returned empty text")
        return result


_engine: HuggingFaceTranslationEngine | None = None
_engine_lock = threading.Lock()


def get_translation_engine() -> HuggingFaceTranslationEngine:
    global _engine
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is None:
            _engine = HuggingFaceTranslationEngine(DEFAULT_MT_MODEL)
    return _engine


def has_loaded_translation_engine() -> bool:
    return _engine is not None


def translate_to_zh(text: str) -> str:
    return get_translation_engine().translate(text)
