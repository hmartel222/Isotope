# Stripe SDK transition note

Reviewed compatibility context for the repository's Stripe test transition.

- Package: `stripe`
- Ecosystem: npm
- Dependency transition exercised by the repository: `17.7.0` to `18.1.0`
- Breaking threshold in the existing human-reviewed ChangeSpec: `18.0.0`
- Provider payload transition: `2025-02-24.acacia` to `2026-08-26.dahlia`
- Golden ChangeSpec: `stripe.basil.subscription-period`

The package transition chooses the ChangeSpec. The provider payload versions are independently bound from the captured fixture metadata and label the deterministic old/new runs.
