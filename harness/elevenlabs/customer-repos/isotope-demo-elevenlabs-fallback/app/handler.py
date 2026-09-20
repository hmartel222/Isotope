from typing import Any, Dict

from .audio_repository import AudioRepository
from .models import PublishJob
from .speech_service import SpeechService


def handle_publish_job(payload: Dict[str, Any], speech_service: SpeechService, audio_repository: AudioRepository) -> Dict[str, Any]:
    job = PublishJob.from_dict(payload)
    narration = speech_service.synthesize(text=job.text, voice_id=job.voice_id)
    record = audio_repository.save(
        job_id=job.job_id,
        article_id=job.article_id,
        content=narration.content,
        content_type="audio/mpeg",
    )
    return {
        "job_id": job.job_id,
        "article_id": job.article_id,
        "status": "stored",
        "audio_source": narration.source,
        "storage_key": record.storage_key,
    }
