# ChangeSpec compiler completion status

## Implemented locally

- Approval readiness is fail-closed and binds the exact compilation report hash.
- Approved-envelope validation rejects unknowns, unsupported features, abstention, suspected injection, unresolved project binding, missing evidence, and hash mutations.
- Project binding uses the production TypeScript or Python resolver against the repository's validated `isotope.yml`, hashes the matched source/configuration, and is recomputed before an approved bundle can be selected.
- Product fixture binding uses one shared loader with containment, JSON, metadata, provenance, version, pair, and hash checks.
- The trusted manual compilation workflow confines and hashes reviewed sources, uses Node 20, optionally binds fixtures, uploads audits, and never approves.
- PR verification reads an approved bundle from the exact base SHA and has no Gemini secret or write permission.
- The Action accepts approved bundles and emits selected spec ID, bundle hash, and selection rationale.
- Golden-equivalence comparison tooling rejects changes to roots, paths, cardinality, and fixture identity while allowing only documented identity/timing fields.
- Reviewed Stripe and ElevenLabs source packets and manifests are present.

## Remaining external gates

1. Supply a Gemini credential in the trusted environment and perform live Stripe and ElevenLabs compilation.
2. Add reviewed non-synthetic ElevenLabs v2 planning and held-out fixtures.
3. Review and explicitly approve live candidates, then run full Stripe and ElevenLabs golden equivalence.
4. Decide whether to commit and push; neither action has been taken.
5. After a push, dispatch and inspect the public workflows before making a public-success claim.
