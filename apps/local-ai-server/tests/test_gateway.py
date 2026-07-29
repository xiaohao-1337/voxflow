from __future__ import annotations

import asyncio
import json
import struct
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.ws.gateway import (
    health_response,
    is_origin_allowed,
    recv_frame,
    recv_json,
    validate_request_security,
)
from src.config import is_loopback_host


def masked_frame(payload: bytes, opcode: int = 0x1) -> bytes:
    mask = b"\x01\x02\x03\x04"
    header = bytearray([0x80 | opcode])
    length = len(payload)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65_536:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", length))
    encoded = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    return bytes(header) + mask + encoded


class GatewaySecurityTests(unittest.TestCase):
    def test_only_loopback_bind_hosts_are_allowed(self) -> None:
        self.assertTrue(is_loopback_host("127.0.0.1"))
        self.assertTrue(is_loopback_host("::1"))
        self.assertTrue(is_loopback_host("localhost"))
        self.assertFalse(is_loopback_host("0.0.0.0"))

    def test_origin_allowlist_supports_exact_and_prefix_rules(self) -> None:
        allowed = ("chrome-extension://abc", "moz-extension://*")
        self.assertTrue(is_origin_allowed("chrome-extension://abc", allowed))
        self.assertTrue(is_origin_allowed("moz-extension://generated-id", allowed))
        self.assertFalse(is_origin_allowed("https://example.com", allowed))

    def test_token_and_browser_origin_are_enforced(self) -> None:
        allowed = ("chrome-extension://*",)
        self.assertEqual(
            validate_request_security(
                "/ws?token=wrong",
                {"origin": "chrome-extension://abc"},
                "secret",
                allowed,
            ),
            (401, "Unauthorized"),
        )
        self.assertEqual(
            validate_request_security(
                "/ws?token=secret",
                {"origin": "https://example.com"},
                "secret",
                allowed,
            ),
            (403, "Forbidden Origin"),
        )
        self.assertIsNone(
            validate_request_security(
                "/ws?token=secret",
                {"origin": "chrome-extension://abc"},
                "secret",
                allowed,
            )
        )

    @patch("src.ws.gateway.model_health")
    def test_health_contract_reports_degraded_models(self, mocked_health) -> None:
        mocked_health.return_value = {
            "asr": {"ready": False, "path": "/asr", "missing": ["model.pt"]},
            "mt": {"ready": True, "path": "/mt", "missing": []},
            "tts": {"ready": False, "path": "/tts", "missing": ["provider/model not configured"]},
        }
        payload = health_response(token_required=True, origin_policy_enabled=True)
        self.assertEqual(payload["protocol"], "voxflow.local.v1")
        self.assertEqual(payload["status"], "degraded")
        self.assertTrue(payload["security"]["tokenRequired"])


class GatewayFrameTests(unittest.IsolatedAsyncioTestCase):
    async def test_masked_json_object_is_accepted(self) -> None:
        reader = asyncio.StreamReader()
        reader.feed_data(masked_frame(json.dumps({"type": "test"}).encode()))
        reader.feed_eof()
        self.assertEqual(await recv_json(reader), {"type": "test"})

    async def test_unmasked_client_frame_is_rejected(self) -> None:
        reader = asyncio.StreamReader()
        reader.feed_data(b"\x81\x02{}")
        reader.feed_eof()
        with self.assertRaisesRegex(ValueError, "must be masked"):
            await recv_frame(reader)

    async def test_fragmented_frame_is_rejected(self) -> None:
        frame = bytearray(masked_frame(b"{}"))
        frame[0] &= 0x7F
        reader = asyncio.StreamReader()
        reader.feed_data(bytes(frame))
        reader.feed_eof()
        with self.assertRaisesRegex(ValueError, "fragmented"):
            await recv_frame(reader)


if __name__ == "__main__":
    unittest.main()
