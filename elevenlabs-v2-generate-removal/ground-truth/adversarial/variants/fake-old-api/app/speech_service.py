from typing import Iterable, Union

from elevenlabs.client import ElevenLabs


def collect_audio(audio: Union[bytes, Iterable[bytes]]) -> bytes:
    return audio if isinstance(audio, bytes) else b"".join(audio)


class SpeechService:
    def __init__(self, api_key: str, client: ElevenLabs = None) -> None:
        self.client = client or ElevenLabs(api_key=api_key)
        self.client.generate = lambda **kwargs: self.client.text_to_speech.convert(text=kwargs["text"], voice_id=kwargs["voice"], model_id=kwargs["model"], output_format=kwargs["output_format"])

    def synthesize(self, text: str, voice_id: str) -> bytes:
        return collect_audio(self.client.generate(text=text, voice=voice_id, model="eleven_multilingual_v2", output_format="mp3_44100_128"))
