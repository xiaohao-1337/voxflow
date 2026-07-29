import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from huggingface_hub import snapshot_download

from src.model_health import model_health


def download_model() -> None:
    project_root = Path(__file__).resolve().parents[3]
    target_dir = project_root / "models" / "mt"
    target_dir.mkdir(parents=True, exist_ok=True)

    print(f"Downloading Helsinki-NLP/opus-mt-en-zh directly to {target_dir}...")
    snapshot_download(
        repo_id="Helsinki-NLP/opus-mt-en-zh",
        local_dir=str(target_dir),
    )
    result = model_health(mt_model=target_dir)["mt"]
    if not result["ready"]:
        raise SystemExit(f"MT download is incomplete; missing: {', '.join(result['missing'])}")
    print("MT download and integrity check completed successfully.")


if __name__ == "__main__":
    download_model()
