import importlib.metadata
import json
import socket
import unittest
from typing import Any, Iterator

from app.audio_repository import AudioRepository
from app.handler import handle_publish_job
from app.speech_service import SpeechService


PAYLOAD = {
    "job_id": "publish_plan_A",
    "article_id": "article_plan_A",
    "text": "The morning briefing is now available.",
    "voice_id": "JBFqnCBsd6RMkjVDRZzb",
}


def deterministic_convert(voice_id: str = None, *, text: str, model_id: str = None, output_format: str = None, **_kwargs: Any) -> Iterator[bytes]:
    logical = {"model_id": model_id, "output_format": output_format, "text": text, "voice_id": voice_id}
    content = b"ELEVENLABS_TEST_AUDIO|" + json.dumps(logical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    midpoint = len(content) // 2
    return iter((content[:midpoint], content[midpoint:]))


def execute() -> tuple[dict[str, Any], AudioRepository]:
    service = SpeechService(api_key="test-key")
    service.client.text_to_speech.convert = deterministic_convert
    repository = AudioRepository()
    original = (socket.socket.connect, socket.create_connection, socket.getaddrinfo)

    def blocked(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("network access is prohibited")

    socket.socket.connect = blocked
    socket.create_connection = blocked
    socket.getaddrinfo = blocked
    try:
        returned = handle_publish_job(PAYLOAD, service, repository)
    finally:
        socket.socket.connect, socket.create_connection, socket.getaddrinfo = original
    return returned, repository


class FallbackAmbiguityTests(unittest.TestCase):
    def test_sink_remains_present_across_sdk_versions(self) -> None:
        returned, repository = execute()
        self.assertEqual(returned["status"], "stored")
        self.assertEqual(len(repository.calls), 1)
        expected_source = "provider" if importlib.metadata.version("elevenlabs") == "1.59.0" else "fallback"
        self.assertEqual(returned["audio_source"], expected_source)

    def test_execution_is_deterministic(self) -> None:
        first_returned, first_repository = execute()
        second_returned, second_repository = execute()
        self.assertEqual(first_returned, second_returned)
        self.assertEqual(first_repository.calls, second_repository.calls)


if __name__ == "__main__":
    unittest.main()
