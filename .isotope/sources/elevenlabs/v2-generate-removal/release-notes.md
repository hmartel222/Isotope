# ElevenLabs dependency transition note

- Package: `elevenlabs`
- Ecosystem: PyPI
- Dependency transition represented by this source packet: `1.59.0` to `2.0.0`
- Provider breaking release: `2.0.0`
- Language: Python
- Intended golden behavior: detect use of the removed `generate` helper and its replacement by `text_to_speech.convert`

The current hand-authored repository specimen predates this exact v2 transition. A live result must therefore remain unapproved until its product fixture evidence and golden reference are aligned through review.
