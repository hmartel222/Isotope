from typing import Iterable, Union

from elevenlabs.client import ElevenLabs


MODEL_ID = "eleven_multilingual_v2"
OUTPUT_FORMAT = "mp3_44100_128"


def collect_audio(audio: Union[bytes, Iterable[bytes]]) -> bytes:
    if isinstance(audio, bytes):
        return audio
    return b"".join(audio)


class SpeechService:
    def __init__(self, api_key: str, client: ElevenLabs = None) -> None:
        self.client = client or ElevenLabs(api_key=api_key)

    def synthesize(self, text: str, voice_id: str) -> bytes:
        audio = self.client.generate(
            text=text,
            voice=voice_id,
            model=MODEL_ID,
            output_format=OUTPUT_FORMAT,
        )
        return collect_audio(audio)
