"""Small PCM helpers for the local-engine protocol smoke test."""

from __future__ import annotations

import array
import math
import struct


def f32le_stats(payload: bytes) -> dict[str, float | int]:
    """Return sample count, rms, peak, and duration-ish metadata for f32le PCM."""
    if len(payload) % 4 != 0:
        raise ValueError(f"f32le payload length must be divisible by 4, got {len(payload)}")

    samples = array.array("f")
    samples.frombytes(payload)
    if struct.pack("=f", 1.0) != struct.pack("<f", 1.0):
        samples.byteswap()

    if not samples:
        return {"samples": 0, "rms": 0.0, "peak": 0.0}

    sum_sq = 0.0
    peak = 0.0
    for sample in samples:
        value = float(sample)
        sum_sq += value * value
        peak = max(peak, abs(value))

    return {
        "samples": len(samples),
        "rms": math.sqrt(sum_sq / len(samples)),
        "peak": peak,
    }
