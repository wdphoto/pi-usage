# Handoff — pi-usage

## Current state

- Release baseline is **v0.0.3** (`package.json` is authoritative; experimental
  checkpoints use `0.0.x`). See `CHANGELOG.md` for the versioned record and
  `AGENTS.md` for the "ship it" release workflow.
- Footer follows the selected provider: GPT for `openai`/`openai-codex`, OLM
  for Ollama Cloud, hidden otherwise. Both providers keep polling and `/usage`
  still reports both.
- Model switches cut the footer to the theme foreground and fade to normal in
  one second; warning/error digits stay steady.
- GPT 5h and Ollama monthly windows show a pace marker `▲` (accent when
  projected above 100% before reset, warning above 150%), computed from
  observed percentage and elapsed window time only.
- Short-window countdowns go from `1h` directly to `59m`, never `60m`.

## Validation

- Before release: `npm test` (24 passed), `npm run pack:check`,
  `git diff --check`.
- Tests are offline with invented credentials and mocked transport; they do
  not establish live upstream compatibility.

## Resume notes

- Modern OpenAI ChatGPT OAuth acceptance by the private quota endpoint remains
  unverified live. Do not perform live checks without explicit authorization.
- Keep this file checkout-only; it is not in the package file allowlist.
