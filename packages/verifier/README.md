# @isotope/verifier

Independent Phase 9 L10 verification. It rebuilds the patched BDG, regenerates deterministic signatures, compares the immutable original-old baseline to patched-new behavior, performs a secondary patched-old/patched-new check, repeats the protocol on held-out evidence, and rejects degenerate patch shapes.

Only the `verified` outcome can produce `verified-repair.json`.
