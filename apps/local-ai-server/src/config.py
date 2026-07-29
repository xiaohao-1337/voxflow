"""Runtime defaults for the VoxFlow local AI engine."""

import os
from ipaddress import ip_address
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

DEFAULT_TOKEN = os.environ.get("VOXFLOW_LOCAL_ENGINE_TOKEN", "").strip()
_ORIGINS_ENV = os.environ.get("VOXFLOW_ALLOWED_ORIGINS", "").strip()
DEFAULT_ALLOWED_ORIGINS = tuple(
    origin.strip() for origin in _ORIGINS_ENV.split(",") if origin.strip()
) or (
    "chrome-extension://*",
    "moz-extension://*",
)


def is_loopback_host(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False
