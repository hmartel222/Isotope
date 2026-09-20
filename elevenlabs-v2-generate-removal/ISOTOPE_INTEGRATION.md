# Intended Dependabot integration

This directory is the contents of a separate benchmark repository. The base commit should contain `requirements.txt` pinned to `elevenlabs==1.59.0`. Dependabot should open a pull request that changes only that pin to `2.0.0`. The pull request CI then runs the benchmark and should expose the dependency-only break before any application migration is applied.

The local `isotope.yml` and `specs/elevenlabs-python-v1-v2-generate-removal.yaml` describe the entry point, Python provider root, and application sink. The CI workflow creates isolated old and new Python environments, then supplies those interpreters to Isotope. Isotope preserves the real installed ElevenLabs client and intercepts only the underlying text-to-speech transport.

The workflow passes `--specs specs`, `ISOTOPE_PYTHON_OLD`, and `ISOTOPE_PYTHON_NEW` explicitly. The configured `real-method` adapter patches `ElevenLabs.text_to_speech.convert` on real client instances, while `method-record` observes `AudioRepository.save`. Because interception is optional on the breaking side, v2 authentically fails at the absent `client.generate` surface instead of being classified as an unexercised mock.

The standalone command is:

```bash
python3 scripts/verify_environments.py \
  --old-python .venv-old/bin/python \
  --new-python .venv-new/bin/python \
  --write-results
```
