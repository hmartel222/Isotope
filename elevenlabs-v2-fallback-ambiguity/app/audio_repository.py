from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Dict, List


@dataclass(frozen=True)
class AudioRecord:
    storage_key: str


class AudioRepository:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    def save(self, *, job_id: str, article_id: str, content: bytes, content_type: str) -> AudioRecord:
        if not content:
            raise ValueError("audio content must not be empty")
        storage_key = "narration/{}/{}.mp3".format(article_id, job_id)
        self.calls.append({
            "job_id": job_id,
            "article_id": article_id,
            "content_type": content_type,
            "content_length": len(content),
            "content_sha256": sha256(content).hexdigest(),
            "storage_key": storage_key,
        })
        return AudioRecord(storage_key=storage_key)
