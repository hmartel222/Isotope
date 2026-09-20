# Grok acceptance harness

This pack mirrors the Stripe harness for the Chat Completions to Responses API
migration. Offline targets use controlled fixtures and never require
`XAI_API_KEY`; the optional live check is isolated from acceptance.

Targets cover mechanical migration, structured output, tool calls, no-op,
ambiguity, held-out verification, and credential handling.
