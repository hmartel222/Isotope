# Python sidecar

Stdlib AST resolution and isolated harness execution over JSON stdin/stdout. Node bridges in `@isotope/resolver-py` and `@isotope/harness-py` invoke `python3 py-runner/isotope_runner/cli.py` with one JSON document and receive one JSON document. No network, fixtures, or verdicts live in this process.
