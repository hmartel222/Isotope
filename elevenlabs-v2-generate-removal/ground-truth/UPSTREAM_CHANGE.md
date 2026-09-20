# ElevenLabs Python SDK v1 → v2 ground truth

## Versions and dates

- Old: `elevenlabs==1.59.0`, uploaded to PyPI on 2025-05-15.
- New: `elevenlabs==2.0.0`, uploaded to PyPI on 2025-05-20.

These are consecutive stable releases across the v2 major-version boundary.

## Verified callable surfaces

Runtime inspection of the installed 1.59.0 wheel confirms `ElevenLabs.generate` exists with this relevant surface:

```text
(*, text: Union[str, Iterator[str]], voice: Union[str, Voice] = ..., model: Union[str, Model] = "eleven_multilingual_v2", stream: bool = False, output_format = "mp3_44100_128", ...) -> Iterator[bytes]
```

The package source marks the helper deprecated. For a non-streaming string it resolves a voice ID and model ID, then delegates to `self.text_to_speech.convert(...)`.

Runtime inspection of the installed 2.0.0 wheel confirms `ElevenLabs.generate` is absent. Its replacement has this relevant surface:

```text
(voice_id: str, *, text: str, output_format = None, model_id: Optional[str] = ..., ...) -> Iterator[bytes]
```

The official v2 upgrade guide explicitly states that `generate` and `clone` were removed and directs generation callers to `text_to_speech.convert`.

## Argument and return differences

The migration changes the public names `voice` → `voice_id` and `model` → `model_id`. The replacement requires `voice_id` as its first parameter (it may still be passed by keyword). `generate` also exposed a `stream` switch; the non-streaming `convert` replacement does not. Both inspected methods are annotated as returning `Iterator[bytes]`, so this benchmark retains the existing chunk collection rather than inventing a return-shape migration.

The planning voice `JBFqnCBsd6RMkjVDRZzb` appears in the official package usage example. The held-out voice `EXAVITQu4vr4xnSDxMaL` is the packaged v1 default Sarah voice ID. Neither requires a live request because the transport operation is intercepted.

## Why the unchanged application fails

The pre-migration application legitimately calls `self.client.generate(...)`. Under 1.59.0 the real SDK method resolves and delegates into the intercepted text-to-speech operation. Under 2.0.0 attribute lookup raises:

```text
AttributeError: 'ElevenLabs' object has no attribute 'generate'
```

The exception occurs before audio is returned, so `AudioRepository.save(...)` is never called. The oracle changes only the historically required method and argument names.

## Evidence

- Official v2 upgrade guide: https://github.com/elevenlabs/elevenlabs-python/wiki/v2-upgrade-guide
- PyPI 1.59.0 artifact metadata: https://pypi.org/project/elevenlabs/1.59.0/
- PyPI 2.0.0 artifact metadata: https://pypi.org/project/elevenlabs/2.0.0/
- Installed wheel source inspected at `elevenlabs/client.py` (1.59.0) and `elevenlabs/realtime_tts.py` (2.0.0).

## Correction to the initial assumptions

The proposed breaking seam is correct. Two details required correction: 1.59.0 already documented the namespaced `text_to_speech.convert` API as preferred while retaining `generate` as a deprecated compatibility helper, and there is no relevant synchronous return-shape change—both inspected methods return byte iterators.
