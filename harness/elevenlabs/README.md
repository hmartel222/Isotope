# ElevenLabs customer demo deployment

These two public customer repositories exercise the same pinned Isotope Action used by the Stripe demos:

- `isotope-demo-elevenlabs-removal`: a dependency-only ElevenLabs Python 1.59.0 → 2.x update removes `ElevenLabs.generate`, drops the storage sink, and produces a mechanical `FAIL`.
- `isotope-demo-elevenlabs-fallback`: the same removal activates application-owned fallback audio, preserves the storage sink with different content, and produces `ESCALATE` with the business-policy question.

Run `harness/elevenlabs/push-customer-demos.sh` from a clean committed engine checkout. Dependabot opens the customer PRs. Then run `harness/elevenlabs/audit-customer-demos.sh` to verify the pinned Action, blocking checks, and bot-owned rationale comments.

The verify workflow is read-only and uploads validated `.isotope/` evidence. A separate `workflow_run` reporter publishes the comment and check without executing pull-request code with write permissions.
