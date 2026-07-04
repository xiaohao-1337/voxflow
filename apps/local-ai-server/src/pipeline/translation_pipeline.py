"""Translation pipeline using Hugging Face model loaded from local models directory."""

from pathlib import Path
import logging
from transformers import MarianMTModel, MarianTokenizer
from src.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

class HuggingFaceTranslationEngine:
    def __init__(self, model_path: str | Path):
        self.model_path = str(model_path)
        logger.info(f"Initializing HF Translation Engine with model at {self.model_path}")
        self.tokenizer = MarianTokenizer.from_pretrained(self.model_path)
        self.model = MarianMTModel.from_pretrained(self.model_path)

    def translate(self, text: str) -> str:
        if not text.strip():
            return ""
        try:
            inputs = self.tokenizer(text, return_tensors="pt", padding=True)
            outputs = self.model.generate(**inputs)
            translated = self.tokenizer.batch_decode(outputs, skip_special_tokens=True)
            return translated[0] if translated else ""
        except Exception as e:
            logger.error(f"Translation failed: {e}")
            return f"【翻译失败】{text}"

# Global engine instance
_engine = None

def get_translation_engine() -> HuggingFaceTranslationEngine:
    global _engine
    if _engine is None:
        model_dir = PROJECT_ROOT / "models" / "mt"
        _engine = HuggingFaceTranslationEngine(model_dir)
    return _engine

def translate_to_zh(text: str) -> str:
    try:
        return get_translation_engine().translate(text)
    except Exception as e:
        logger.error(f"Failed to load or run translation engine: {e}")
        return f"【翻译错误】{text}"
