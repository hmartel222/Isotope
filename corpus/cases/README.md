# Detection acceptance corpus

These cases are controlled internal repositories because no public corpus forks or provider-produced normalized fixtures are present in this checkout. The matrix materializes each repository as a temporary Git history, commits a Stripe 17.7.0 to 18.1.0 dependency transition, and runs the normal L1 through L4 implementation.

Expectation metadata lives in `detection-cases.json`, outside the repository templates. Fixtures under `fixtures/` are explicitly synthetic and are never copied into `fixtures/raw` or `fixtures/normalized`.
