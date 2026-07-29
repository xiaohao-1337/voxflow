"""Check required ASR/MT model files without importing model runtimes."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.model_health import model_health


def main() -> int:
    health = model_health()
    print(json.dumps(health, ensure_ascii=False, indent=2))
    required_ready = health["asr"]["ready"] and health["mt"]["ready"]
    return 0 if required_ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
