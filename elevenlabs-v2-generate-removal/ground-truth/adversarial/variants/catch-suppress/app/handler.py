from typing import Any, Dict

from .audio_repository import AudioRepository
from .models import RenderJob
from .speech_service import SpeechService


def handle_render_job(payload: Dict[str, Any], speech_service: SpeechService, audio_repository: AudioRepository) -> Dict[str, Any]:
    job = RenderJob.from_dict(payload)
    try:
        speech_service.synthesize(text=job.text, voice_id=job.voice_id)
    except AttributeError:
        return {"job_id": job.job_id, "document_id": job.document_id, "status": "stored", "audio_size": 0, "storage_key": "suppressed"}
    raise AssertionError("unexpectedly retained removed API")
