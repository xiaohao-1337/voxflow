"""Download the default SenseVoiceSmall ASR model and verify its artifacts."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import DEFAULT_ASR_MODEL
from src.model_health import model_health


def download_model() -> None:
    try:
        from modelscope import snapshot_download
    except ImportError as exc:
        raise SystemExit("modelscope is required; install the local engine dependencies first") from exc

    target_dir = Path(DEFAULT_ASR_MODEL)
    target_dir.mkdir(parents=True, exist_ok=True)
    print(f"Downloading iic/SenseVoiceSmall directly to {target_dir}...")
    snapshot_download("iic/SenseVoiceSmall", local_dir=str(target_dir))

    result = model_health()["asr"]
    if not result["ready"]:
        raise SystemExit(f"ASR download is incomplete; missing: {', '.join(result['missing'])}")
    print("ASR download and integrity check completed successfully.")


if __name__ == "__main__":
    download_model()
