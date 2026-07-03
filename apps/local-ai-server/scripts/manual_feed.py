"""Manual audio feeder for the stdlib-only local-engine smoke test."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import math
import os
import socket
import struct
from copy import deepcopy
import wave
from pathlib import Path
from typing import Any

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import DEFAULT_ASR_LANGUAGE, DEFAULT_ASR_MODEL


GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


async def main() -> None:
    parser = argparse.ArgumentParser(description="Feed generated PCM into voxflow-local-engine.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--duration-ms", type=int, default=1200)
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--chunk-ms", type=int, default=120)
    parser.add_argument("--wav", type=Path, help="Optional mono/stereo PCM WAV file to feed instead of a tone.")
    parser.add_argument("--source-lang", default=DEFAULT_ASR_LANGUAGE)
    parser.add_argument("--target-lang", default="zh")
    parser.add_argument("--asr-model", default=DEFAULT_ASR_MODEL)
    parser.add_argument("--asr-language", default=None)
    args = parser.parse_args()

    reader, writer = await asyncio.open_connection(args.host, args.port)
    await websocket_handshake(reader, writer, args.host, args.port)

    session_id = "manual-smoke-test"
    await send_json(
        writer,
        {
            "type": "session.start",
            "sessionId": session_id,
            "sourceLang": args.source_lang,
            "targetLang": args.target_lang,
            "sampleRate": args.sample_rate,
            "asrProvider": "funasr",
            "asrModel": args.asr_model,
            "asrLanguage": args.asr_language or args.source_lang,
            "mtProvider": "argos",
            "ttsProvider": "piper",
        },
    )
    print_event(await recv_json(reader))

    if args.wav:
        samples, sample_rate = read_wav_as_f32(args.wav)
    else:
        sample_rate = args.sample_rate
        samples = make_tone(args.duration_ms, sample_rate)
    chunk_size = max(1, int(sample_rate * args.chunk_ms / 1000))
    seq = 0
    for offset in range(0, len(samples), chunk_size):
        chunk = samples[offset : offset + chunk_size]
        await send_json(
            writer,
            {
                "type": "audio.chunk",
                "sessionId": session_id,
                "seq": seq,
                "timestampMs": int(offset / sample_rate * 1000),
                "sampleRate": sample_rate,
                "format": "f32le",
                "audio": base64.b64encode(pack_f32le(chunk)).decode("ascii"),
            },
        )
        seq += 1
        for event in await drain_events(reader, timeout=0.03):
            print_event(event)

    await asyncio.sleep(0.2)
    for event in await drain_events(reader, timeout=0.05, max_events=20):
        print_event(event)

    await send_json(writer, {"type": "session.stop", "sessionId": session_id})
    for event in await drain_until_stopped(reader):
        print_event(event)
    await send_close(writer)
    writer.close()
    await writer.wait_closed()


def make_tone(duration_ms: int, sample_rate: int) -> list[float]:
    total = int(duration_ms * sample_rate / 1000)
    return [0.25 * math.sin(2 * math.pi * 440 * i / sample_rate) for i in range(total)]


def read_wav_as_f32(path: Path) -> tuple[list[float], int]:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())

    if sample_width != 2:
        raise ValueError(f"Only PCM16 WAV is supported for manual feed, got sample width {sample_width}")

    values = struct.unpack("<" + "h" * (len(frames) // 2), frames)
    mono: list[float] = []
    for offset in range(0, len(values), channels):
        frame = values[offset : offset + channels]
        mono.append(sum(frame) / len(frame) / 32768.0)
    return mono, sample_rate


def pack_f32le(samples: list[float]) -> bytes:
    return struct.pack("<" + "f" * len(samples), *samples)


async def websocket_handshake(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    host: str,
    port: int,
) -> None:
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    writer.write(
        (
            "GET /ws HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        ).encode("ascii")
    )
    await writer.drain()
    response = await reader.readuntil(b"\r\n\r\n")
    if b" 101 " not in response:
        raise RuntimeError(f"WebSocket upgrade failed: {response.decode('iso-8859-1')}")


async def send_json(writer: asyncio.StreamWriter, payload: dict[str, Any]) -> None:
    await send_frame(writer, json.dumps(payload, ensure_ascii=False).encode("utf-8"))


async def recv_json(reader: asyncio.StreamReader) -> dict[str, Any]:
    opcode, payload = await recv_frame(reader)
    if opcode != 0x1:
        raise RuntimeError(f"expected text frame, got opcode {opcode}")
    return json.loads(payload.decode("utf-8"))


async def drain_events(
    reader: asyncio.StreamReader,
    timeout: float,
    max_events: int = 10,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for _ in range(max_events):
        try:
            events.append(await asyncio.wait_for(recv_json(reader), timeout=timeout))
        except TimeoutError:
            break
    return events


async def drain_until_stopped(
    reader: asyncio.StreamReader,
    timeout: float = 10.0,
    max_events: int = 20,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for _ in range(max_events):
        event = await asyncio.wait_for(recv_json(reader), timeout=timeout)
        events.append(event)
        if event.get("type") == "engine.status" and event.get("message") == "stopped":
            break
    return events


def print_event(event: dict[str, Any]) -> None:
    display = deepcopy(event)
    audio = display.get("audio")
    if isinstance(audio, str):
        display["audio"] = f"<base64 {len(audio)} chars>"
    print(display)


async def recv_frame(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    first, second = await reader.readexactly(2)
    opcode = first & 0x0F
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
    payload = await reader.readexactly(length)
    return opcode, payload


async def send_frame(writer: asyncio.StreamWriter, payload: bytes, opcode: int = 0x1) -> None:
    mask = os.urandom(4)
    header = bytearray([0x80 | opcode])
    length = len(payload)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", length))
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    writer.write(bytes(header) + mask + masked)
    await writer.drain()


async def send_close(writer: asyncio.StreamWriter) -> None:
    await send_frame(writer, b"", opcode=0x8)


if __name__ == "__main__":
    # Avoid localhost resolving to IPv6 first on some systems when users pass localhost.
    socket.getaddrinfo
    asyncio.run(main())
