"""Small stdlib WebSocket gateway for the VoxFlow local engine."""

from __future__ import annotations

import asyncio
import base64
from functools import partial
import hashlib
import hmac
import json
import struct
from typing import Any
from urllib.parse import parse_qs, urlsplit

from src.config import (
    DEFAULT_ALLOWED_ORIGINS,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_TOKEN,
    is_loopback_host,
)
from src.model_health import model_health
from src.pipeline.translation_pipeline import has_loaded_translation_engine
from src.providers.asr.funasr_engine import has_loaded_funasr_engine
from src.ws.session import PROTOCOL_VERSION, LocalEngineSession

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME_BYTES = 2 * 1024 * 1024
AI_PIPELINE_LOCK = asyncio.Lock()


class WebSocketClosed(Exception):
    """Raised when the peer closes the WebSocket."""


async def run_server(
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    *,
    token: str = DEFAULT_TOKEN,
    allowed_origins: tuple[str, ...] = DEFAULT_ALLOWED_ORIGINS,
) -> None:
    if not is_loopback_host(host):
        raise ValueError("VoxFlow local engine only supports loopback hosts")
    callback = partial(handle_client, token=token, allowed_origins=allowed_origins)
    server = await asyncio.start_server(callback, host, port)
    sockets = ", ".join(str(sock.getsockname()) for sock in server.sockets or [])
    print(f"voxflow-local-engine listening on ws://{host}:{port}/ws ({sockets})")
    print(f"health check available at http://{host}:{port}/health")
    print(
        "gateway security: "
        f"token={'required' if token else 'disabled'}, "
        f"browser origins={','.join(allowed_origins) if allowed_origins else 'disabled'}"
    )
    async with server:
        await server.serve_forever()


async def handle_client(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    *,
    token: str = DEFAULT_TOKEN,
    allowed_origins: tuple[str, ...] = DEFAULT_ALLOWED_ORIGINS,
) -> None:
    try:
        path, headers = await read_http_upgrade(reader)
        route = urlsplit(path).path
        security_error = validate_request_security(path, headers, token, allowed_origins)
        if security_error:
            await write_http_error(writer, *security_error)
            return
        if route == "/health":
            await write_http_json(
                writer,
                200,
                "OK",
                health_response(
                    token_required=bool(token),
                    origin_policy_enabled=bool(allowed_origins),
                ),
                origin=headers.get("origin"),
            )
            return
        if route != "/ws":
            await write_http_error(writer, 404, "Not Found")
            return
        if headers.get("upgrade", "").lower() != "websocket":
            await write_http_error(writer, 426, "Upgrade Required")
            return
        if headers.get("sec-websocket-version") != "13":
            await write_http_error(writer, 400, "Unsupported WebSocket Version")
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
        message = await recv_json(reader, writer)
        try:
            if (
                message.get("type") == "session.start"
                and message.get("v") == PROTOCOL_VERSION
                and isinstance(message.get("sessionId"), str)
                and message["sessionId"]
            ):
                await send_json(
                    writer,
                    status_for_message(
                        message,
                        "loading",
                        "Loading local ASR model",
                        stage="asr",
                    ),
                )
            elif message.get("type") == "audio.end":
                await send_json(
                    writer,
                    session.status(
                        "running",
                        "Running ASR and translation",
                        stage="asr",
                        request_id=message.get("requestId"),
                    ),
                )
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


def validate_request_security(
    path: str,
    headers: dict[str, str],
    token: str,
    allowed_origins: tuple[str, ...],
) -> tuple[int, str] | None:
    origin = headers.get("origin")
    if origin and allowed_origins and not is_origin_allowed(origin, allowed_origins):
        return 403, "Forbidden Origin"
    if token:
        supplied = request_token(path, headers)
        if not supplied or not hmac.compare_digest(supplied, token):
            return 401, "Unauthorized"
    return None


def is_origin_allowed(origin: str, allowed_origins: tuple[str, ...]) -> bool:
    for pattern in allowed_origins:
        if pattern.endswith("*") and origin.startswith(pattern[:-1]):
            return True
        if hmac.compare_digest(origin, pattern):
            return True
    return False


def request_token(path: str, headers: dict[str, str]) -> str:
    authorization = headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    values = parse_qs(urlsplit(path).query).get("token")
    return values[0] if values else ""


def health_response(*, token_required: bool, origin_policy_enabled: bool) -> dict[str, Any]:
    models = model_health()
    loaded_stages = int(has_loaded_funasr_engine()) + int(has_loaded_translation_engine())
    model_state = ("cold", "partial", "ready")[loaded_stages]
    return {
        "service": "voxflow-local-engine",
        "version": "0.1.0",
        "protocol": PROTOCOL_VERSION,
        "status": "ok" if models["asr"]["ready"] and models["mt"]["ready"] else "degraded",
        "modelState": model_state,
        "models": models,
        "capabilities": {
            "stages": ["asr", "mt"],
            "inputSampleFormats": ["f32le", "pcm16le"],
            "sourceLanguages": ["en"],
            "targetLanguages": ["zh-Hans"],
        },
        "security": {
            "tokenRequired": token_required,
            "originPolicyEnabled": origin_policy_enabled,
        },
    }


def status_for_message(
    message: dict[str, Any],
    state: str,
    detail: str,
    *,
    stage: str | None = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "v": PROTOCOL_VERSION,
        "type": "engine.status",
        "sessionId": str(message.get("sessionId") or ""),
        "requestId": message.get("requestId"),
        "state": state,
        "message": detail,
    }
    if stage:
        event["stage"] = stage
    return event


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


async def write_http_json(
    writer: asyncio.StreamWriter,
    status: int,
    reason: str,
    payload: dict[str, Any],
    *,
    origin: str | None = None,
) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    cors = f"Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n" if origin else ""
    writer.write(
        (
            f"HTTP/1.1 {status} {reason}\r\n"
            "Connection: close\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            "Cache-Control: no-store\r\n"
            f"{cors}"
            f"Content-Length: {len(body)}\r\n"
            "\r\n"
        ).encode("ascii")
        + body
    )
    await writer.drain()


async def recv_json(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter | None = None,
) -> dict[str, Any]:
    while True:
        opcode, payload = await recv_frame(reader)
        if opcode == 0x8:
            raise WebSocketClosed()
        if opcode == 0x9:
            if writer is not None:
                await send_frame(writer, payload, opcode=0xA)
            continue
        if opcode == 0xA:
            continue
        if opcode != 0x1:
            raise ValueError(f"expected text frame, got opcode {opcode}")
        parsed = json.loads(payload.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("WebSocket JSON message must be an object")
        return parsed


async def send_json(writer: asyncio.StreamWriter, payload: dict[str, Any]) -> None:
    await send_frame(writer, json.dumps(payload, ensure_ascii=False).encode("utf-8"))


async def recv_frame(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    first, second = await reader.readexactly(2)
    if not first & 0x80:
        raise ValueError("fragmented WebSocket frames are not supported")
    if first & 0x70:
        raise ValueError("WebSocket extensions are not supported")
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    if not masked:
        raise ValueError("client WebSocket frames must be masked")
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
    if length > MAX_FRAME_BYTES:
        raise ValueError(f"WebSocket frame exceeds {MAX_FRAME_BYTES} bytes")
    if opcode >= 0x8 and length > 125:
        raise ValueError("WebSocket control frame payload exceeds 125 bytes")
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
