"""Entrypoint for the VoxFlow local AI engine."""

from __future__ import annotations

import argparse
import asyncio

from src.config import (
    DEFAULT_ALLOWED_ORIGINS,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_TOKEN,
    is_loopback_host,
)
from src.ws.gateway import run_server


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the VoxFlow local AI engine.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--token",
        default=DEFAULT_TOKEN,
        help="Optional shared token. Prefer VOXFLOW_LOCAL_ENGINE_TOKEN to avoid shell history.",
    )
    parser.add_argument(
        "--allow-origin",
        action="append",
        dest="allowed_origins",
        help="Allowed browser Origin. Supports a trailing * prefix wildcard; may be repeated.",
    )
    args = parser.parse_args()
    if not is_loopback_host(args.host):
        parser.error("VoxFlow local engine only supports loopback hosts (127.0.0.1, ::1, localhost)")
    try:
        asyncio.run(
            run_server(
                args.host,
                args.port,
                token=args.token,
                allowed_origins=tuple(args.allowed_origins or DEFAULT_ALLOWED_ORIGINS),
            )
        )
    except KeyboardInterrupt:
        print("\nvoxflow-local-engine stopped")


if __name__ == "__main__":
    main()
