#!/usr/bin/env python3
import argparse
import importlib.metadata
import json
import socket
import sys
from pathlib import Path
from typing import Any, Dict, Iterator, List


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.audio_repository import AudioRepository  # noqa: E402
from app.handler import handle_render_job  # noqa: E402


def deterministic_audio(*, text: str, voice_id: str, model_id: str, output_format: str) -> bytes:
    logical_request = {
        "model_id": model_id,
        "output_format": output_format,
        "text": text,
        "voice_id": voice_id,
    }
    return b"ELEVENLABS_TEST_AUDIO|" + json.dumps(
        logical_request, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def deterministic_convert(
    voice_id: str = None,
    *,
    text: str,
    model_id: str = None,
    output_format: str = None,
    **_kwargs: Any
) -> Iterator[bytes]:
    audio = deterministic_audio(
        text=text,
        voice_id=voice_id,
        model_id=model_id,
        output_format=output_format,
    )
    midpoint = len(audio) // 2
    return iter((audio[:midpoint], audio[midpoint:]))


def execute(mode: str, fixture_path: Path) -> Dict[str, Any]:
    from elevenlabs.client import ElevenLabs

    if mode == "oracle":
        from oracle.post_migration.speech_service import SpeechService
    elif mode == "original":
        from app.speech_service import SpeechService
    else:
        raise ValueError("mode must be original or oracle")

    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    network_attempts: List[str] = []
    original_connect = socket.socket.connect
    original_create_connection = socket.create_connection
    original_getaddrinfo = socket.getaddrinfo

    def blocked_connect(_socket: socket.socket, address: Any) -> None:
        network_attempts.append(repr(address))
        raise RuntimeError("benchmark network access is prohibited")

    def blocked_create_connection(address: Any, *_args: Any, **_kwargs: Any) -> None:
        network_attempts.append(repr(address))
        raise RuntimeError("benchmark network access is prohibited")

    def blocked_getaddrinfo(host: Any, port: Any, *_args: Any, **_kwargs: Any) -> None:
        network_attempts.append(repr((host, port)))
        raise RuntimeError("benchmark network access is prohibited")

    socket.socket.connect = blocked_connect
    socket.create_connection = blocked_create_connection
    socket.getaddrinfo = blocked_getaddrinfo
    repository = AudioRepository()
    returned = None
    threw = None
    try:
        client = ElevenLabs(api_key="test-key")
        client.text_to_speech.convert = deterministic_convert
        service = SpeechService(api_key="test-key", client=client)
        returned = handle_render_job(payload, service, repository)
    except Exception as error:
        threw = {"type": type(error).__name__, "message": str(error)}
    finally:
        socket.socket.connect = original_connect
        socket.create_connection = original_create_connection
        socket.getaddrinfo = original_getaddrinfo

    return {
        "fixture": str(fixture_path.relative_to(ROOT)),
        "mode": mode,
        "networkAttempts": network_attempts,
        "sdkVersion": importlib.metadata.version("elevenlabs"),
        "signature": {"calls": repository.calls, "returned": returned, "threw": threw},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("original", "oracle"), required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    args = parser.parse_args()
    fixture = args.fixture if args.fixture.is_absolute() else ROOT / args.fixture
    print(json.dumps(execute(args.mode, fixture), sort_keys=True))


if __name__ == "__main__":
    main()
