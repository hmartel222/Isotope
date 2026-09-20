from dataclasses import dataclass
from typing import Any, Dict


@dataclass(frozen=True)
class PublishJob:
    job_id: str
    article_id: str
    text: str
    voice_id: str

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "PublishJob":
        return cls(
            job_id=str(payload["job_id"]),
            article_id=str(payload["article_id"]),
            text=str(payload["text"]),
            voice_id=str(payload["voice_id"]),
        )
