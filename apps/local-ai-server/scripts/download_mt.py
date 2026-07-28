from pathlib import Path

from huggingface_hub import snapshot_download


def download_model() -> None:
    project_root = Path(__file__).resolve().parents[3]
    target_dir = project_root / "models" / "mt"
    target_dir.mkdir(parents=True, exist_ok=True)

    print(f"Downloading Helsinki-NLP/opus-mt-en-zh directly to {target_dir}...")
    snapshot_download(
        repo_id="Helsinki-NLP/opus-mt-en-zh",
        local_dir=str(target_dir),
    )
    print("Download completed successfully.")

if __name__ == "__main__":
    download_model()
