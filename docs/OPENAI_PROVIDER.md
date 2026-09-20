# OpenAI provider

Isotope models a Chat Completions to Responses API migration with a ChangeSpec
and controlled response fixtures. Provider behavior is isolated in the
fixture-call adapter; generic selection, AST resolution, execution, diffing,
reasoning, and reporting are shared with Stripe and ElevenLabs.
