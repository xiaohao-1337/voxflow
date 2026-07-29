from __future__ import annotations

import base64
import struct
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.providers.asr.funasr_engine import FunAsrUnavailable
from src.ws.session import LocalEngineSession


class FakeFunAsr:
    def __init__(self, text: str = "hello world") -> None:
        self.text = text

    def transcribe_f32le(self, pcm: bytes, sample_rate: int) -> str:
        self.last_pcm = pcm
        self.last_sample_rate = sample_rate
        return self.text


def session_start(stages: list[str] | None = None) -> dict:
    return {
        "v": "voxflow.local.v1",
        "type": "session.start",
        "sessionId": "test-session",
        "requestId": "start-1",
        "pipeline": {"stages": stages or ["asr", "mt"], "emitIntermediates": True},
        "models": {
            "asr": {"provider": "funasr", "language": "en", "device": "cpu"},
            "mt": {
                "provider": "huggingface",
                "sourceLang": "en",
                "targetLang": "zh",
            },
        },
        "input": {
            "audio": {
                "streamId": "audio-1",
                "sampleRate": 16000,
                "channels": 1,
                "sampleFormat": "f32le",
                "codec": "pcm",
            }
        },
    }


def audio_chunk(seq: int = 0, sample_count: int = 4) -> dict:
    values = [0.1 if index % 2 == 0 else -0.1 for index in range(sample_count)]
    samples = struct.pack("<" + "f" * sample_count, *values)
    return {
        "v": "voxflow.local.v1",
        "type": "audio.chunk",
        "sessionId": "test-session",
        "requestId": f"audio-{seq}",
        "streamId": "audio-1",
        "seq": seq,
        "time": {"startMs": 0, "durationMs": 1},
        "audio": {
            "transport": "json.base64",
            "codec": "pcm",
            "sampleFormat": "f32le",
            "sampleRate": 16000,
            "channels": 1,
            "frameCount": sample_count,
            "byteLength": len(samples),
            "data": base64.b64encode(samples).decode("ascii"),
        },
    }


def audio_end(last_seq: int = 0) -> dict:
    return {
        "v": "voxflow.local.v1",
        "type": "audio.end",
        "sessionId": "test-session",
        "requestId": "end-1",
        "streamId": "audio-1",
        "lastSeq": last_seq,
        "reason": "segment_complete",
    }


class LocalEngineSessionTests(unittest.TestCase):
    @patch("src.ws.session.get_funasr_engine", return_value=FakeFunAsr())
    def test_asr_and_mt_emit_only_v1_final_events(self, _get_engine) -> None:
        session = LocalEngineSession()
        start_events = session.start(session_start())
        self.assertEqual(start_events[-1]["state"], "ready")

        session.ingest_audio(audio_chunk())
        with patch("src.ws.session.translate_to_zh", return_value="你好，世界"):
            events = session.end_audio(audio_end())

        event_types = [event["type"] for event in events]
        self.assertIn("asr.final", event_types)
        self.assertIn("mt.final", event_types)
        self.assertIn("result.final", event_types)
        self.assertNotIn("translation.final", event_types)
        result = next(event for event in events if event["type"] == "result.final")
        self.assertEqual(result["translatedText"], "你好，世界")

    @patch("src.ws.session.get_funasr_engine", return_value=FakeFunAsr())
    def test_rejects_out_of_order_audio(self, _get_engine) -> None:
        session = LocalEngineSession()
        session.start(session_start(["asr"]))
        with self.assertRaisesRegex(ValueError, "sequence mismatch"):
            session.ingest_audio(audio_chunk(seq=1))

    @patch("src.ws.session.get_funasr_engine", return_value=FakeFunAsr())
    def test_empty_audio_returns_error_instead_of_fake_transcript(self, _get_engine) -> None:
        session = LocalEngineSession()
        session.start(session_start(["asr"]))
        events = session.end_audio(audio_end(last_seq=-1))
        error = next(event for event in events if event["type"] == "error")
        self.assertEqual(error["code"], "empty_audio")
        self.assertFalse(any(event["type"] == "result.final" for event in events))

    @patch(
        "src.ws.session.get_funasr_engine",
        side_effect=FunAsrUnavailable("model missing"),
    )
    def test_model_load_failure_is_nonrecoverable(self, _get_engine) -> None:
        session = LocalEngineSession()
        events = session.start(session_start(["asr"]))
        error = next(event for event in events if event["type"] == "error")
        self.assertEqual(error["code"], "funasr_unavailable")
        self.assertFalse(error["recoverable"])
        self.assertEqual(events[-1]["state"], "error")

    def test_tts_request_fails_explicitly(self) -> None:
        session = LocalEngineSession()
        events = session.start(session_start(["asr", "mt", "tts"]))
        error = next(event for event in events if event["type"] == "error")
        self.assertEqual(error["code"], "tts_unavailable")
        self.assertFalse(any(event["type"] == "tts.audio" for event in events))

    def test_session_id_is_required(self) -> None:
        message = session_start(["asr"])
        del message["sessionId"]
        session = LocalEngineSession()
        events = session.start(message)
        error = next(event for event in events if event["type"] == "error")
        self.assertEqual(error["code"], "invalid_session")
        self.assertFalse(any(event["type"] == "session.started" for event in events))

    def test_protocol_version_is_required(self) -> None:
        message = session_start(["asr"])
        del message["v"]
        session = LocalEngineSession()
        events = session.start(message)
        error = next(event for event in events if event["type"] == "error")
        self.assertEqual(error["code"], "unsupported_protocol")

    @patch("src.ws.session.get_funasr_engine", return_value=FakeFunAsr())
    def test_audio_end_validates_stream_and_last_sequence(self, _get_engine) -> None:
        session = LocalEngineSession()
        session.start(session_start(["asr"]))
        session.ingest_audio(audio_chunk())

        bad_stream = audio_end()
        bad_stream["streamId"] = "other"
        with self.assertRaisesRegex(ValueError, "streamId"):
            session.end_audio(bad_stream)

        bad_sequence = audio_end(last_seq=2)
        with self.assertRaisesRegex(ValueError, "lastSeq mismatch"):
            session.end_audio(bad_sequence)

    def test_unimplemented_mt_provider_is_rejected(self) -> None:
        message = session_start()
        message["models"]["mt"]["provider"] = "ctranslate2"
        session = LocalEngineSession()
        events = session.start(message)
        error = next(event for event in events if event["type"] == "error")
        self.assertEqual(error["code"], "mt_provider_unavailable")

    @patch("src.ws.session.get_funasr_engine", return_value=FakeFunAsr())
    def test_audio_stats_are_aggregated_and_flushed_at_end(self, _get_engine) -> None:
        session = LocalEngineSession()
        session.start(session_start(["asr"]))

        for seq in range(4):
            self.assertEqual(session.ingest_audio(audio_chunk(seq, sample_count=3200)), [])
        fifth_events = session.ingest_audio(audio_chunk(4, sample_count=3200))
        self.assertEqual([event["type"] for event in fifth_events], ["audio.stats"])
        self.assertEqual(fifth_events[0]["durationMs"], 1000)

        session.ingest_audio(audio_chunk(5, sample_count=1600))
        events = session.end_audio(audio_end(last_seq=5))
        self.assertEqual(events[0]["type"], "audio.stats")
        self.assertEqual(events[0]["durationMs"], 1100)


if __name__ == "__main__":
    unittest.main()
