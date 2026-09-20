from dataclasses import dataclass
from typing import Any, Dict


@dataclass(frozen=True)
class RenderJob:
    job_id: str
    document_id: str
    text: str
    voice_id: str

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "RenderJob":
        fields = {name: value.get(name) for name in ("job_id", "document_id", "text", "voice_id")}
        if any(not isinstance(item, str) or not item for item in fields.values()):
            raise ValueError("render job fields must be non-empty strings")
        return cls(**fields)
