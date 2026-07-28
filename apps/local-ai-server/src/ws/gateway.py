"""Small stdlib WebSocket gateway for the VoxFlow local engine."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import struct
from typing import Any

from src.config import DEFAULT_HOST, DEFAULT_PORT
from src.ws.session import LocalEngineSession

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME_BYTES = 2 * 1024 * 1024
AI_PIPELINE_LOCK = asyncio.Lock()


class WebSocketClosed(Exception):
    """Raised when the peer closes the WebSocket."""


async def run_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    server = await asyncio.start_server(handle_client, host, port)
    sockets = ", ".join(str(sock.getsockname()) for sock in server.sockets or [])
    print(f"voxflow-local-engine listening on ws://{host}:{port}/ws ({sockets})")
    async with server:
        await server.serve_forever()


async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        path, headers = await read_http_upgrade(reader)
        if path.partition("?")[0] != "/ws":
            await write_http_error(writer, 404, "Not Found")
            return
        key = headers.get("sec-websocket-key")
        if not key:
            await write_http_error(writer, 400, "Missing Sec-WebSocket-Key")
            return
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")
        writer.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n"
                "\r\n"
            ).encode("ascii")
        )
        await writer.drain()
        await handle_messages(reader, writer)
    except (WebSocketClosed, asyncio.IncompleteReadError, ConnectionResetError):
        pass
    except Exception as exc:  # pragma: no cover - smoke-test server logging
        print(f"client error: {exc}")
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except (BrokenPipeError, ConnectionError):
            pass


async def handle_messages(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    session = LocalEngineSession()
    while True:
        message = await recv_json(reader)
        try:
            events = await dispatch(session, message)
        except Exception as exc:
            events = [session.error("bad_request", str(exc), recoverable=True)]
        for event in events:
            await send_json(writer, event)


async def dispatch(session: LocalEngineSession, message: dict[str, Any]) -> list[dict[str, Any]]:
    msg_type = message.get("type")
    if msg_type == "session.start":
        return await run_ai_task(session.start, message)
    if msg_type == "audio.chunk":
        return session.ingest_audio(message)
    if msg_type == "audio.end":
        return await run_ai_task(session.end_audio, message)
    if msg_type == "session.stop":
        return await run_ai_task(session.stop)
    if msg_type == "session.cancel":
        return session.cancel(message)
    if msg_type == "session.close":
        return session.cancel(message)
    if msg_type == "media.state":
        return []
    return [session.error("unknown_message", str(msg_type), recoverable=True)]


async def run_ai_task(function: Any, *args: Any) -> list[dict[str, Any]]:
    async with AI_PIPELINE_LOCK:
        return await asyncio.to_thread(function, *args)


async def read_http_upgrade(reader: asyncio.StreamReader) -> tuple[str, dict[str, str]]:
    raw = await reader.readuntil(b"\r\n\r\n")
    text = raw.decode("iso-8859-1")
    lines = text.split("\r\n")
    request = lines[0].split()
    if len(request) < 2:
        raise ValueError("invalid HTTP upgrade request")
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if not line or ":" not in line:
            continue
        name, value = line.split(":", 1)
        headers[name.strip().lower()] = value.strip()
    return request[1], headers


async def write_http_error(writer: asyncio.StreamWriter, status: int, reason: str) -> None:
    body = f"{status} {reason}\n".encode("utf-8")
    writer.write(
        (
            f"HTTP/1.1 {status} {reason}\r\n"
            "Connection: close\r\n"
            f"Content-Length: {len(body)}\r\n"
            "\r\n"
        ).encode("ascii")
        + body
    )
    await writer.drain()


async def recv_json(reader: asyncio.StreamReader) -> dict[str, Any]:
    opcode, payload = await recv_frame(reader)
    if opcode == 0x8:
        raise WebSocketClosed()
    if opcode != 0x1:
        raise ValueError(f"expected text frame, got opcode {opcode}")
    return json.loads(payload.decode("utf-8"))


async def send_json(writer: asyncio.StreamWriter, payload: dict[str, Any]) -> None:
    await send_frame(writer, json.dumps(payload, ensure_ascii=False).encode("utf-8"))


async def recv_frame(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    first, second = await reader.readexactly(2)
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
    if length > MAX_FRAME_BYTES:
        raise ValueError(f"WebSocket frame exceeds {MAX_FRAME_BYTES} bytes")
    mask = await reader.readexactly(4) if masked else b""
    payload = await reader.readexactly(length)
    if masked:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    return opcode, payload


async def send_frame(writer: asyncio.StreamWriter, payload: bytes, opcode: int = 0x1) -> None:
    header = bytearray([0x80 | opcode])
    length = len(payload)
    if length < 126:
        header.append(length)
    elif length < 65536:
        header.append(126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(127)
        header.extend(struct.pack("!Q", length))
    writer.write(bytes(header) + payload)
    await writer.drain()
