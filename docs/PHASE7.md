# Phase 7 detection credibility matrix

Phase 7 adds acceptance infrastructure around the existing deterministic L1 through L4 pipeline. `isotope matrix` materializes each controlled repository template as an isolated temporary Git repository, commits the declared base and head dependency versions, performs ChangeSpec selection, analyzes provider provenance, executes stable old and new provider fixtures when an authoritative site exists, and compares the product verdict with external expectation metadata.

The five required cases are declared in `corpus/cases/detection-cases.json`. Expectations never enter resolver, harness, differ, or verdict logic. Each run retains the product artifacts in `.isotope/matrix/<case-id>/` and writes a deterministic matrix summary to `.isotope/matrix/results.json`.

This checkout contains no `corpus-ffsd`, `corpus-genius`, `corpus-nyaai`, `corpus-payjp`, `corpus-multi`, or provider-produced normalized fixture pairs. The current gate therefore uses internal controlled repositories and fixtures under `corpus/cases/`. Every fixture declares `synthetic: true`; none is stored under the product fixture directories. These cases establish pipeline behavior without claiming results for a public repository or real provider capture.

Run all required cases with:

```sh
pnpm isotope matrix
```

Run one case with `pnpm isotope matrix --case mechanical-break`. Add `--keep-artifacts` to retain its temporary Git repository as well as the authoritative matrix artifacts. Missing fixtures are reported as blocked; `--allow-blocked` is available for exploratory runs, while the default required gate fails on blocked cases.

The implemented set covers mechanical `FAIL`, migrated `PASS`, no-op `PASS`, provenance-protected `SKIP`, and ambiguity `ESCALATE`. GitHub Actions, L5 semantic reasoning, repair, Python, and the remaining v3 corpus repositories remain outside Phase 7.
