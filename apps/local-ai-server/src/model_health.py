"""Fast, dependency-free checks for locally installed model artifacts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.config import DEFAULT_ASR_MODEL, DEFAULT_MT_MODEL

MIN_WEIGHT_BYTES = 1024 * 1024


def model_health(
    asr_model: str | Path = DEFAULT_ASR_MODEL,
    mt_model: str | Path = DEFAULT_MT_MODEL,
) -> dict[str, dict[str, Any]]:
    return {
        "asr": check_model(
            asr_model,
            required=("config.yaml", "model.pt"),
            weight_candidates=("model.pt",),
        ),
        "mt": check_model(
            mt_model,
            required=("config.json", "source.spm", "target.spm", "vocab.json"),
            weight_candidates=("model.safetensors", "pytorch_model.bin"),
        ),
        "tts": {
            "ready": False,
            "path": str(Path(DEFAULT_ASR_MODEL).parents[1] / "tts"),
            "missing": ["provider/model not configured"],
        },
    }


def check_model(
    path: str | Path,
    *,
    required: tuple[str, ...],
    weight_candidates: tuple[str, ...],
) -> dict[str, Any]:
    directory = Path(path).expanduser().resolve()
    missing = [name for name in required if not _valid_regular_file(directory / name)]
    weights = [directory / name for name in weight_candidates]
    if not any(_valid_weight_file(weight) for weight in weights):
        missing.append(" or ".join(weight_candidates))
    return {
        "ready": not missing,
        "path": str(directory),
        "missing": missing,
    }


def _valid_regular_file(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0 and not _is_git_lfs_pointer(path)


def _valid_weight_file(path: Path) -> bool:
    return _valid_regular_file(path) and path.stat().st_size >= MIN_WEIGHT_BYTES


def _is_git_lfs_pointer(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size > 1024:
        return False
    try:
        return path.read_bytes().startswith(b"version https://git-lfs.github.com/spec/v1")
    except OSError:
        return True
