# Design

The Grok behavior is represented by a ChangeSpec and fixture-call adapter.
The generic resolver follows `entrypoint.ts` through `service.ts` into the
Grok client and the store. Responses API output is compared by observable
text or tool-call behavior rather than provider-specific logic in the core.
