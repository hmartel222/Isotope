from dataclasses import asdict, dataclass
from hashlib import sha256
from typing import Any, Dict, List


@dataclass(frozen=True)
class AudioRecord:
    storage_key: str
    job_id: str
    document_id: str
    content_type: str
    content_length: int
    content_sha256: str


class AudioRepository:
    """Application-owned storage boundary with structurally recorded calls."""

    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    def save(
        self,
        *,
        job_id: str,
        document_id: str,
        content: bytes,
        content_type: str,
    ) -> AudioRecord:
        if not content:
            raise ValueError("generated audio must not be empty")
        record = AudioRecord(
            storage_key="audio/{}/{}.mp3".format(document_id, job_id),
            job_id=job_id,
            document_id=document_id,
            content_type=content_type,
            content_length=len(content),
            content_sha256=sha256(content).hexdigest(),
        )
        self.calls.append({"mock": "audio_repository.save", "args": asdict(record)})
        return record
