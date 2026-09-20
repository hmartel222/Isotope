from dataclasses import dataclass
from typing import Iterable, Union

from elevenlabs.client import ElevenLabs


MODEL_ID = "eleven_multilingual_v2"
OUTPUT_FORMAT = "mp3_44100_128"
FALLBACK_AUDIO = b"LOCAL_FALLBACK_AUDIO|narration-temporarily-unavailable"


def collect_audio(audio: Union[bytes, Iterable[bytes]]) -> bytes:
    if isinstance(audio, bytes):
        return audio
    return b"".join(audio)


@dataclass(frozen=True)
class SynthesisResult:
    content: bytes
    source: str


class SpeechService:
    def __init__(self, api_key: str) -> None:
        self.client = ElevenLabs(api_key=api_key)

    def synthesize(self, text: str, voice_id: str) -> SynthesisResult:
        try:
            audio = self.client.generate(
                text=text,
                voice=voice_id,
                model=MODEL_ID,
                output_format=OUTPUT_FORMAT,
            )
            return SynthesisResult(content=collect_audio(audio), source="provider")
        except Exception:
            # Publishing policy predates the SDK migration: retain an audible
            # placeholder when the narration provider is unavailable.
            return SynthesisResult(content=FALLBACK_AUDIO, source="fallback")
