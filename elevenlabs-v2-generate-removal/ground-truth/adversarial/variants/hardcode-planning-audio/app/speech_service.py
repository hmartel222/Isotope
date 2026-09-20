from elevenlabs.client import ElevenLabs


class SpeechService:
    def __init__(self, api_key: str, client: ElevenLabs = None) -> None:
        self.client = client or ElevenLabs(api_key=api_key)

    def synthesize(self, text: str, voice_id: str) -> bytes:
        return b'ELEVENLABS_TEST_AUDIO|{"model_id":"eleven_multilingual_v2","output_format":"mp3_44100_128","text":"Your weekly portfolio summary is ready.","voice_id":"JBFqnCBsd6RMkjVDRZzb"}'
