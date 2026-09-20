from typing import Iterable, Union

from elevenlabs.client import ElevenLabs


def collect_audio(audio: Union[bytes, Iterable[bytes]]) -> bytes:
    return audio if isinstance(audio, bytes) else b"".join(audio)


class SpeechService:
    def __init__(self, api_key: str, client: ElevenLabs = None) -> None:
        self.client = client or ElevenLabs(api_key=api_key)

    def synthesize(self, text: str, voice_id: str) -> bytes:
        return collect_audio(self.client.text_to_speech.convert(text=text, voice_id=voice_id, model_id="eleven_multilingual_v2", output_format="mp3_44100_128"))
