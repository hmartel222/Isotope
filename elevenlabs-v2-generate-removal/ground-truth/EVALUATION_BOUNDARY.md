# Evaluation boundary

Planner-facing evidence may include the pre-migration `app/` source, dependency pins, the selected ChangeSpec supplied by an evaluator, affected dataflow, the planning fixture, and planning signatures/diffs.

The semantic reasoner may receive bounded source/dataflow evidence and normalized planning behavior. It must not receive expected repair code or held-out results.

The repair planner must not read:

- `oracle/`
- `ground-truth/human-fix.patch`
- `ground-truth/observed-results.json`
- `ground-truth/adversarial/`
- `fixtures/heldout/`
- any held-out signature, expected hash, or verification result

Those paths are evaluator-only. Held-out execution occurs only after a candidate has been generated and applied in an isolated verification workspace.
