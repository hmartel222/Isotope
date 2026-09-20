# Optional live Grok testing

The Grok example uses xAI's OpenAI-compatible Responses API. Set `XAI_API_KEY`
and optionally `XAI_TEST_MODEL`,
then run:

```sh
node --test tests/grok-live.test.cjs
```

The live test is skipped when the key is absent and is never part of offline
acceptance or automatic repair evidence. The key is sent only as a bearer
credential to `https://api.x.ai/v1/responses` and is never printed or written
to artifacts.
