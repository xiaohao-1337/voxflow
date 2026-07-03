"""Runtime defaults for the VoxFlow local AI engine."""

from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765

PROJECT_ROOT = Path(__file__).resolve().parents[3]

# SenseVoiceSmall is the local-first multilingual FunASR model used for the
# first real ASR test. It supports English and Chinese with CPU inference.
DEFAULT_ASR_MODEL = str(PROJECT_ROOT / "models" / "asr" / "SenseVoiceSmall")
DEFAULT_ASR_LANGUAGE = "en"
