"""Entrypoint for the VoxFlow local AI engine."""

from __future__ import annotations

import argparse
import asyncio

from src.config import DEFAULT_HOST, DEFAULT_PORT
from src.ws.gateway import run_server


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the VoxFlow local AI engine.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    try:
        asyncio.run(run_server(args.host, args.port))
    except KeyboardInterrupt:
        print("\nvoxflow-local-engine stopped")


if __name__ == "__main__":
    main()
