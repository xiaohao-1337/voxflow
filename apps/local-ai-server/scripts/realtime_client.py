"""Terminal client for feeding WAV audio into voxflow-local-engine."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import struct
import time
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import DEFAULT_ASR_LANGUAGE, DEFAULT_ASR_MODEL, DEFAULT_HOST, DEFAULT_PORT


GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
PROTOCOL_VERSION = "voxflow.local.v1"


@dataclass
class ClientState:
    ready: asyncio.Event
    done: asyncio.Event
    failed: bool = False
    failure: str | None = None


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Feed a WAV file to voxflow-local-engine and print realtime processing events."
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--wav", type=Path, default=Path("tmp/hello.wav"))
    parser.add_argument("--chunk-ms", type=int, default=200)
    parser.add_argument(
        "--stages",
        default="asr,mt",
        help="Comma-separated pipeline stages: asr, asr,mt, or asr,mt,tts.",
    )
    parser.add_argument("--source-lang", default=DEFAULT_ASR_LANGUAGE)
    parser.add_argument("--target-lang", default="zh")
    parser.add_argument("--asr-model", default=DEFAULT_ASR_MODEL)
    parser.add_argument("--asr-language", default=None)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--fast", action="store_true", help="Send audio as fast as possible instead of realtime pacing.")
    parser.add_argument("--verbose", action="store_true", help="Print audio.stats and unknown raw events.")
    parser.add_argument("--ready-timeout", type=float, default=60.0)
    parser.add_argument("--result-timeout", type=float, default=120.0)
    args = parser.parse_args()

    wav_path = args.wav.expanduser().resolve()
    samples, sample_rate = read_wav_as_f32(wav_path)
    stages = parse_stages(args.stages)
    chunk_size = max(1, int(sample_rate * args.chunk_ms / 1000))
    session_id = args.session_id or f"terminal-{int(time.time())}"

    print(f"[connect] ws://{args.host}:{args.port}/ws")
    reader, writer = await asyncio.open_connection(args.host, args.port)
    await websocket_handshake(reader, writer, args.host, args.port)

    state = ClientState(ready=asyncio.Event(), done=asyncio.Event())
    receiver = asyncio.create_task(receive_loop(reader, state, args.verbose))
    try:
        await send_json(writer, build_session_start(args, stages, session_id, sample_rate))
        await asyncio.wait_for(state.ready.wait(), timeout=args.ready_timeout)
        if state.failed:
            raise RuntimeError(state.failure or "local engine failed before it became ready")

        print(
            f"[audio] {wav_path.name} rate={sample_rate}Hz samples={len(samples)} "
            f"duration={len(samples) / sample_rate:.2f}s chunk={args.chunk_ms}ms stages={','.join(stages)}"
        )
        await feed_audio(writer, samples, sample_rate, chunk_size, args.chunk_ms, session_id, args.fast)
        await send_json(
            writer,
            {
                "v": PROTOCOL_VERSION,
                "type": "audio.end",
                "sessionId": session_id,
                "requestId": "terminal-audio-end",
                "streamId": "terminal-audio",
                "lastSeq": max(0, (len(samples) + chunk_size - 1) // chunk_size - 1),
                "reason": "segment_complete",
            },
        )

        await asyncio.wait_for(state.done.wait(), timeout=args.result_timeout)
        if state.failed:
            raise RuntimeError(state.failure or "local engine processing failed")
    finally:
        try:
            await send_close(writer)
        except (ConnectionError, RuntimeError):
            pass
        receiver.cancel()
        await asyncio.gather(receiver, return_exceptions=True)
        writer.close()
        await writer.wait_closed()


def build_session_start(args: argparse.Namespace, stages: list[str], session_id: str, sample_rate: int) -> dict[str, Any]:
    return {
        "v": PROTOCOL_VERSION,
        "type": "session.start",
        "sessionId": session_id,
        "requestId": "terminal-start",
        "pipeline": {
            "stages": stages,
            "emitIntermediates": True,
            "latencyMode": "balanced",
        },
        "models": {
            "asr": {
                "provider": "funasr",
                "model": args.asr_model,
                "language": args.asr_language or args.source_lang,
                "device": args.device,
                "mode": "segment",
            },
            "mt": {
                "provider": "huggingface",
                "sourceLang": args.source_lang,
                "targetLang": args.target_lang,
            },
            "tts": {
                "provider": "local",
                "language": args.target_lang,
                "outputAudio": {
                    "codec": "pcm",
                    "sampleFormat": "pcm16le",
                    "sampleRate": sample_rate,
                    "channels": 1,
                },
            },
        },
        "input": {
            "audio": {
                "streamId": "terminal-audio",
                "sampleRate": sample_rate,
                "channels": 1,
                "sampleFormat": "f32le",
                "codec": "pcm",
                "frameDurationMs": args.chunk_ms,
            }
        },
    }


async def feed_audio(
    writer: asyncio.StreamWriter,
    samples: list[float],
    sample_rate: int,
    chunk_size: int,
    chunk_ms: int,
    session_id: str,
    fast: bool,
) -> None:
    total_chunks = (len(samples) + chunk_size - 1) // chunk_size
    for seq, offset in enumerate(range(0, len(samples), chunk_size)):
        chunk = samples[offset : offset + chunk_size]
        await send_json(
            writer,
            {
                "v": PROTOCOL_VERSION,
                "type": "audio.chunk",
                "sessionId": session_id,
                "requestId": f"terminal-audio-{seq}",
                "streamId": "terminal-audio",
                "seq": seq,
                "time": {
                    "startMs": int(offset / sample_rate * 1000),
                    "durationMs": int(len(chunk) / sample_rate * 1000),
                },
                "audio": {
                    "transport": "json.base64",
                    "codec": "pcm",
                    "sampleFormat": "f32le",
                    "endianness": "little",
                    "sampleRate": sample_rate,
                    "channels": 1,
                    "channelLayout": "mono",
                    "frameCount": len(chunk),
                    "byteLength": len(chunk) * 4,
                    "data": base64.b64encode(pack_f32le(chunk)).decode("ascii"),
                },
            },
        )
        print_progress(seq + 1, total_chunks, offset + len(chunk), len(samples), sample_rate)
        if not fast:
            await asyncio.sleep(chunk_ms / 1000)
    print()


async def receive_loop(reader: asyncio.StreamReader, state: ClientState, verbose: bool) -> None:
    try:
        while True:
            event = await recv_json(reader)
            print_event(event, verbose)
            event_type = event.get("type")
            if event_type == "engine.status" and event.get("state") == "ready":
                state.ready.set()
            elif event_type == "error":
                state.failed = True
                state.failure = f"{event.get('code')}: {event.get('message')}"
                if not event.get("recoverable", True):
                    state.ready.set()
                    state.done.set()
            elif event_type == "result.final":
                state.done.set()
            elif event_type == "engine.status" and event.get("state") == "stopped":
                state.done.set()
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        state.failed = True
        state.failure = f"connection_failed: {exc}"
        state.ready.set()
        state.done.set()
        print(f"\n[ERROR] {state.failure}")


def print_event(event: dict[str, Any], verbose: bool) -> None:
    event_type = event.get("type")
    if event_type == "session.started":
        stages = ",".join(event.get("acceptedStages") or [])
        print(f"[session] started id={event.get('sessionId')} stages={stages}")
    elif event_type == "engine.status":
        stage = f" stage={event.get('stage')}" if event.get("stage") else ""
        print(f"[engine] {event.get('state')}{stage} {event.get('message') or ''}".rstrip())
    elif event_type == "asr.partial":
        print(f"\n[ASR partial] {event.get('text') or ''}")
    elif event_type == "asr.final":
        print(f"\n[ASR final] {event.get('text') or ''}")
    elif event_type == "mt.partial":
        target = event.get("target") if isinstance(event.get("target"), dict) else {}
        print(f"\n[MT partial] {target.get('text') or event.get('text') or ''}")
    elif event_type == "mt.final":
        target = event.get("target") if isinstance(event.get("target"), dict) else {}
        source = event.get("source") if isinstance(event.get("source"), dict) else {}
        print(f"[MT final] {target.get('text') or ''}")
        if verbose and source.get("text"):
            print(f"[MT source] {source.get('text')}")
    elif event_type == "tts.audio":
        audio = event.get("audio")
        if isinstance(audio, dict):
            print(
                "[TTS audio] "
                f"{audio.get('codec')}/{audio.get('sampleFormat')} "
                f"{audio.get('sampleRate')}Hz {audio.get('durationMs')}ms "
                f"{audio.get('byteLength')} bytes"
            )
        elif isinstance(audio, str):
            print(f"[TTS audio] base64 {len(audio)} chars")
    elif event_type == "tts.final":
        print(f"[TTS final] chunks={event.get('chunks')} duration={event.get('durationMs')}ms")
    elif event_type == "result.final":
        print_result(event)
    elif event_type == "error":
        print(f"\n[ERROR] {event.get('code')}: {event.get('message')}")
    elif event_type == "audio.stats":
        if verbose:
            print(
                f"\n[audio.stats] chunks={event.get('chunks')} "
                f"duration={event.get('durationMs')}ms rms={event.get('rms')} peak={event.get('peak')}"
            )
    elif verbose:
        print(f"\n[event] {sanitize_event(event)}")


def print_result(event: dict[str, Any]) -> None:
    kind = event.get("kind")
    print("\n[RESULT]")
    if kind == "asr":
        print(f"  ASR: {event.get('text') or ''}")
    elif kind == "text":
        print(f"  ASR: {event.get('sourceText') or ''}")
        print(f"  MT : {event.get('translatedText') or ''}")
    elif kind == "audio":
        print(f"  ASR: {event.get('sourceText') or ''}")
        print(f"  MT : {event.get('translatedText') or ''}")
        print(f"  TTS: chunks={event.get('audioChunks')} format={event.get('audioFormat')}")
    else:
        print(f"  {sanitize_event(event)}")


def print_progress(sent_chunks: int, total_chunks: int, sent_samples: int, total_samples: int, sample_rate: int) -> None:
    percent = min(100.0, sent_chunks / max(1, total_chunks) * 100)
    seconds = min(sent_samples, total_samples) / sample_rate
    print(f"\r[send] {sent_chunks}/{total_chunks} chunks {percent:5.1f}% {seconds:6.2f}s", end="", flush=True)


def read_wav_as_f32(path: Path) -> tuple[list[float], int]:
    if not path.exists():
        raise FileNotFoundError(f"WAV file does not exist: {path}")
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())

    if channels < 1:
        raise ValueError("WAV file has no audio channels")
    if sample_width != 2:
        raise ValueError(f"Only PCM16 WAV is supported, got sample width {sample_width}")

    values = struct.unpack("<" + "h" * (len(frames) // 2), frames)
    mono: list[float] = []
    for offset in range(0, len(values), channels):
        frame = values[offset : offset + channels]
        mono.append(sum(frame) / len(frame) / 32768.0)
    return mono, sample_rate


def pack_f32le(samples: list[float]) -> bytes:
    return struct.pack("<" + "f" * len(samples), *samples)


def parse_stages(value: str) -> list[str]:
    stages = [stage.strip() for stage in value.split(",") if stage.strip()]
    allowed = {"asr", "mt", "tts"}
    parsed = [stage for stage in stages if stage in allowed]
    if not parsed:
        parsed = ["asr", "mt"]
    if "tts" in parsed and "mt" not in parsed:
        parsed.insert(parsed.index("tts"), "mt")
    if ("mt" in parsed or "tts" in parsed) and "asr" not in parsed:
        parsed.insert(0, "asr")
    return dedupe(parsed)


def dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def sanitize_event(event: dict[str, Any]) -> dict[str, Any]:
    display = dict(event)
    audio = display.get("audio")
    if isinstance(audio, str):
        display["audio"] = f"<base64 {len(audio)} chars>"
    elif isinstance(audio, dict):
        audio_display = dict(audio)
        if isinstance(audio_display.get("data"), str):
            audio_display["data"] = f"<base64 {len(audio_display['data'])} chars>"
        display["audio"] = audio_display
    return display


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
    if opcode == 0x8:
        raise RuntimeError("WebSocket closed by server")
    if opcode != 0x1:
        raise RuntimeError(f"expected text frame, got opcode {opcode}")
    return json.loads(payload.decode("utf-8"))


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
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[stopped] interrupted by user", file=sys.stderr)
    except Exception as exc:
        print(f"[fatal] {exc}", file=sys.stderr)
        raise SystemExit(1) from None
