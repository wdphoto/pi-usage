# Handoff — paused 2026-07-17

## Current state

- `pi-usage` is an independent Git checkout, private and installed locally.
- Development baseline is now **0.0.1** (previous manifest value: `0.1.0`).
  `package.json` is authoritative; README and CHANGELOG track the baseline.
- Audited current source and package contents: no pi-tokometer code, token
  counting, inference-cost tracking, or replacement-footer implementation.
- Quotas appear via Pi's standard `setStatus` row: GPT 5h, GPT weekly, then
  Ollama monthly. Footer visibility does not stop polling or notifications.
- README and AGENTS document current behavior, safety, and `0.0.x` checkpoint
  versioning. CHANGELOG is included in the package allowlist.

## Working tree

Work is **uncommitted**. Preserve all existing changes:

- Modified: `README.md`, `extensions/usage/index.ts`, `package.json`,
  `src/quota.ts`, `src/sources.ts`, `test/switching.test.ts`,
  `test/usage.test.ts`.
- New: `AGENTS.md`, `CHANGELOG.md`, `test/windows.test.ts`, this handoff.

The implementation and test edits predated the most recent version/documentation
pass. That pass changed only package metadata, README, AGENTS, and CHANGELOG.
No commit, tag, publication, or remote mutation was performed.

## Validation

From this checkout:

- `npm test`: **19 passed**, no failures.
- `npm run pack:check`: passed; six package files, version `0.0.1`.
  Includes CHANGELOG; excludes tests and AGENTS.
- `git diff --check`: passed before this handoff was added.

Tests are offline with invented credentials and mocked transport. No network
request, real credential access, or live API call occurred during this pass.
These tests do not establish live upstream compatibility.

## Resume notes

- Read `AGENTS.md`; inspect the working diff before making further changes.
- Modern OpenAI ChatGPT OAuth acceptance by the private quota endpoint remains
  unverified live. README documents the limitation; do not perform a live check
  without explicit authorization.
- No new implementation task is queued. Review/commit the existing work when
  requested; do not automatically bump versions, tag, or publish.
- Keep this handoff checkout-only (outside the package file allowlist).
