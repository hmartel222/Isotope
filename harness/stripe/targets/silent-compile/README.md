# Silent compile, behavioral break

The suppression is directly over the removed field access. `tsc --noEmit` therefore succeeds, while replay still observes the dropped database value and fails.
