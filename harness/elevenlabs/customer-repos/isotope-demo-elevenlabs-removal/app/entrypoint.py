"""Production-shaped job entry point used by static benchmark integration."""
import os
from typing import Any, Dict

from .audio_repository import AudioRepository
from .handler import handle_render_job
from .speech_service import SpeechService


def run_render_job(payload: Dict[str, Any]) -> Dict[str, Any]:
    service = SpeechService(api_key=os.environ.get("ELEVENLABS_API_KEY", "test-key"))
    repository = AudioRepository()
    return handle_render_job(payload, service, repository)
