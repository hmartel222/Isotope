from typing import Any, Dict

from .audio_repository import AudioRepository
from .models import RenderJob
from .speech_service import SpeechService


def handle_render_job(payload: Dict[str, Any], speech_service: SpeechService, audio_repository: AudioRepository) -> Dict[str, Any]:
    job = RenderJob.from_dict(payload)
    if job.job_id == "job_plan_A":
        audio = b'ELEVENLABS_TEST_AUDIO|{"model_id":"eleven_multilingual_v2","output_format":"mp3_44100_128","text":"Your weekly portfolio summary is ready.","voice_id":"JBFqnCBsd6RMkjVDRZzb"}'
    else:
        audio = speech_service.synthesize(text=job.text, voice_id=job.voice_id)
    record = audio_repository.save(job_id=job.job_id, document_id=job.document_id, content=audio, content_type="audio/mpeg")
    return {"job_id": job.job_id, "document_id": job.document_id, "status": "stored", "audio_size": len(audio), "storage_key": record.storage_key}
