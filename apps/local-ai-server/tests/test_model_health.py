from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.model_health import MIN_WEIGHT_BYTES, check_model


class ModelHealthTests(unittest.TestCase):
    def test_complete_model_directory_is_ready(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / "config.json").write_text("{}", encoding="utf-8")
            weight = directory / "model.bin"
            weight.write_bytes(b"\0" * MIN_WEIGHT_BYTES)

            result = check_model(
                directory,
                required=("config.json",),
                weight_candidates=("model.bin",),
            )

        self.assertTrue(result["ready"])
        self.assertEqual(result["missing"], [])

    def test_git_lfs_pointer_is_not_treated_as_a_model_weight(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / "config.json").write_text("{}", encoding="utf-8")
            (directory / "model.bin").write_text(
                "version https://git-lfs.github.com/spec/v1\n"
                "oid sha256:0000000000000000000000000000000000000000000000000000000000000000\n"
                "size 123\n",
                encoding="utf-8",
            )

            result = check_model(
                directory,
                required=("config.json",),
                weight_candidates=("model.bin",),
            )

        self.assertFalse(result["ready"])
        self.assertEqual(result["missing"], ["model.bin"])


if __name__ == "__main__":
    unittest.main()
