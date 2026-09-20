# Commands used to establish and validate ground truth

The temporary environment paths below were used for this validation. Reproduction may use any isolated paths.

```bash
python3 -m venv /private/tmp/isotope-elevenlabs-v1
python3 -m venv /private/tmp/isotope-elevenlabs-v2
/private/tmp/isotope-elevenlabs-v1/bin/pip install elevenlabs==1.59.0
/private/tmp/isotope-elevenlabs-v2/bin/pip install elevenlabs==2.0.0

/private/tmp/isotope-elevenlabs-v1/bin/python -c "import inspect, importlib.metadata as m; from elevenlabs.client import ElevenLabs; c=ElevenLabs(api_key='test-key'); print(m.version('elevenlabs')); print(hasattr(c, 'generate')); print(inspect.signature(c.generate)); print(inspect.getsource(c.generate))"
/private/tmp/isotope-elevenlabs-v2/bin/python -c "import inspect, importlib.metadata as m; from elevenlabs.client import ElevenLabs; c=ElevenLabs(api_key='test-key'); print(m.version('elevenlabs')); print(hasattr(c, 'generate')); print(hasattr(c.text_to_speech, 'convert')); print(inspect.signature(c.text_to_speech.convert)); print(inspect.getsource(c.text_to_speech.convert))"

python3 scripts/generate_patches.py
/private/tmp/isotope-elevenlabs-v1/bin/python -m unittest discover -s tests -v
/private/tmp/isotope-elevenlabs-v2/bin/python -m unittest discover -s tests -v
python3 scripts/verify_environments.py --old-python /private/tmp/isotope-elevenlabs-v1/bin/python --new-python /private/tmp/isotope-elevenlabs-v2/bin/python --write-results
python3 scripts/evaluate_adversarial.py --old-python /private/tmp/isotope-elevenlabs-v1/bin/python --new-python /private/tmp/isotope-elevenlabs-v2/bin/python
```

Read-only repository checks used after generation:

```bash
git status --short
find elevenlabs-v2-generate-removal -type f | sort
rg -n "hasattr\\(.*generate|version\\.starts|fake_modules|requests\\.|httpx\\.|urllib" elevenlabs-v2-generate-removal/app elevenlabs-v2-generate-removal/oracle
```

Official evidence was inspected at:

- https://github.com/elevenlabs/elevenlabs-python/wiki/v2-upgrade-guide
- https://pypi.org/project/elevenlabs/1.59.0/
- https://pypi.org/project/elevenlabs/2.0.0/
