# @isotope/reasoner

Phase 10 L5 semantic reasoning. The package never clears a mechanical failure: eligibility is a pure gate, evidence is sliced from existing L1–L4 artifacts, and two independent votes must agree at medium-or-higher confidence before L6 can emit `PASS_REASONED` or `FAIL_REASONED`.

Related semantic divergences for one entry point are grouped into a single `EvidencePacket`. The primary cluster id is the lexicographically first semantic divergence id; the packet still lists every member. Token accounting uses a conservative local estimator (`ceil(chars / 3)`); the 20k hard cap is therefore estimated, not an exact Gemini tokenizer count. One malformed vote may receive a single mechanical schema retry (`primaryVotes = 2`, `apiAttempts <= 3`). Live calls use `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) with default model `gemini-3.6-flash`.
