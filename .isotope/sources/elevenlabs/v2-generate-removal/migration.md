# ElevenLabs Python SDK v2 migration

Reviewed snapshot of the official ElevenLabs Python v2 upgrade guide.

Source: https://github.com/elevenlabs/elevenlabs-python/wiki/v2-upgrade-guide
Retrieved: 2026-09-21

Version 2 removes the legacy top-level `generate` and `clone` helpers. Text-to-speech generation moves to the client API at `client.text_to_speech.convert(...)`; instant voice cloning moves to `client.voices.ivc.create(...)`.

For the repository's detection case, the removed symbol is `generate`. The replacement call path is `text_to_speech.convert`. The old customer code imports `generate` from `elevenlabs`, so a Python resolver must prove that provider-derived call site before approval.

This reviewed snapshot describes migration evidence only. It does not grant approval, and the repository currently has only explicitly synthetic ElevenLabs payload fixtures.
