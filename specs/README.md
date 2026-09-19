# ChangeSpec registry

Human-verified ChangeSpecs live under `specs/<provider>/`. Each file declares `provider:` and ecosystem package matchers. Stripe Basil, ElevenLabs, Google Maps Places, and synthetic Snowflake `execute()` rows are examples. `specs/isotope-accounts` and `specs/isotope-items` are synthetic provider-interface fixtures, not vendor claims. Draft specs (`verified_by: draft`) may live beside these files and never enter L1.
