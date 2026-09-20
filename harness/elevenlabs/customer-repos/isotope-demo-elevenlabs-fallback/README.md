# ElevenLabs fallback-policy customer demo

This application renders narration through ElevenLabs and stores the resulting audio. It also has a pre-existing resilience policy: if speech generation fails, it stores an application-owned fallback clip so the publishing job can still complete.

With `elevenlabs==1.59.0`, `client.generate(...)` succeeds and provider-derived audio is stored. With `elevenlabs==2.0.0`, that removed method raises `AttributeError`; the application catches the provider failure and stores fallback audio instead. The sink remains present, but its content and the handler's reported audio source change. Whether that degradation is acceptable is a business-policy question, so Isotope should produce `ESCALATE` with semantic evidence rather than a mechanical `FAIL`.

No live ElevenLabs request is made. Isotope imports the real installed package and intercepts only `text_to_speech.convert` to return deterministic bytes.

Dependabot updates `requirements.txt` from ElevenLabs Python 1.59.0 to 2.x. The pinned Isotope Action compares the old and new SDK environments, uploads validated evidence, blocks the pull request for a human decision, and publishes the exact fallback-policy question on the PR.
