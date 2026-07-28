"""Runtime defaults for the VoxFlow local AI engine."""

from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765

PROJECT_ROOT = Path(__file__).resolve().parents[3]

# SenseVoiceSmall is the local-first multilingual FunASR model used for the
# first real ASR test. It supports English and Chinese with CPU inference.
DEFAULT_ASR_MODEL = str(PROJECT_ROOT / "models" / "asr" / "SenseVoiceSmall")
DEFAULT_ASR_LANGUAGE = "en"

_LOCAL_MT_MODEL = PROJECT_ROOT / "models" / "mt"
_LFS_MT_MODEL = PROJECT_ROOT / "apps" / "models" / "mt"
DEFAULT_MT_MODEL = _LOCAL_MT_MODEL if (_LOCAL_MT_MODEL / "config.json").is_file() else _LFS_MT_MODEL
