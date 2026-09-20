# ElevenLabs Python v1 → v2 generate-removal benchmark

This public customer demo captures the documented ElevenLabs Python SDK migration from `elevenlabs==1.59.0` to `elevenlabs==2.0.0`. Dependabot updates `requirements.txt`; the pinned Isotope Action intercepts the PR, writes validated evidence, blocks the incompatible update, and publishes its rationale. It makes no live ElevenLabs request.

## Historical change

The v1 client retained the deprecated `ElevenLabs.generate(...)` helper. The v2 release removed it and directs callers to `ElevenLabs.text_to_speech.convert(...)`. The migration also changes `voice` to `voice_id` and `model` to `model_id`. Direct wheel inspection found both methods return `Iterator[bytes]`.

## Application

A rendering job enters `handle_render_job`, which asks `SpeechService` to synthesize narration, collects the returned chunks, and persists normalized audio through `AudioRepository.save`.

```text
ElevenLabs v1 → client.generate → audio_repository.save → stored
ElevenLabs v2 → client.generate missing → sink disappears → incompatibility
Migrated v2 → text_to_speech.convert → audio_repository.save → stored
```

Tests instantiate the real installed SDK client. They replace only the underlying `text_to_speech.convert` operation with deterministic local audio and install a socket guard. The v2 environment never receives a `generate` polyfill, so the dependency artifact remains causally responsible for the failure.

## Reproduce

```bash
python3 -m venv .venv-old
.venv-old/bin/pip install elevenlabs==1.59.0
python3 -m venv .venv-new
.venv-new/bin/pip install elevenlabs==2.0.0

.venv-old/bin/python -m unittest discover -s tests -v
.venv-new/bin/python -m unittest discover -s tests -v

python3 scripts/verify_environments.py \
  --old-python .venv-old/bin/python \
  --new-python .venv-new/bin/python
```

Run `python3 scripts/generate_patches.py` to regenerate the human and adversarial unified diffs from their source variants. Oracle, held-out, expected results, and adversarial files are evaluator-only as defined in `ground-truth/EVALUATION_BOUNDARY.md`.

## Why it matters

This case exercises a historically documented Python migration through a realistic provider → application → storage dataflow. It supplies dependency-only FAIL, migrated PASS, baseline equivalence, deterministic planning and held-out evidence, plus degenerate and overfit repair controls.
