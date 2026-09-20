import os
from typing import Any, Dict

from .audio_repository import AudioRepository
from .handler import handle_publish_job
from .speech_service import SpeechService


def run_publish_job(payload: Dict[str, Any]) -> Dict[str, Any]:
    service = SpeechService(api_key=os.environ.get("ELEVENLABS_API_KEY", "test-key"))
    repository = AudioRepository()
    return handle_publish_job(payload, service, repository)
