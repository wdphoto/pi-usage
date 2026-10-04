# Changelog

`package.json` is the version source of truth. Experimental checkpoints use
`0.0.x` patch versions; the package remains private and locally installed.

## Unreleased

## 0.0.2 — 2026-10-03

- Footer follows provider selection: GPT for OpenAI/Codex, OLM for Ollama
  Cloud, and no usage status for other models. Both providers keep polling;
  `/usage` still shows all providers and the manual footer toggle is preserved.
- README installation example uses the GitHub repository.

## 0.0.1 — 2026-07-17

Initial version-tracked development baseline (previously labeled `0.1.0` in
the package manifest; no Git release tags existed).

- Independent ChatGPT / Codex 5-hour and weekly subscription quotas, plus
  Ollama monthly included-credit tracking.
- Compact standard-footer status with used percentages, reset countdowns,
  period-specific thresholds, and deduplicated critical notifications.
- `/usage`, `/usage refresh`, `/usage footer`, and `/ollama-usage` alias.
- Modern ChatGPT OAuth selection with legacy authentication fallback only
  when modern OAuth is not selected; explicit private Ollama cookie-file setup.
- Bounded, fixed-origin requests, refresh throttling, failure isolation, and
  cancellation; offline tests with invented credentials and mocked transport.
- Quota-only scope: no pi-tokometer code, token counting, inference-cost
  tracking, or replacement footer.

This baseline records the existing working implementation, not a published
release or a claim of live compatibility with every upstream interface.
