# Repository Guide

## Purpose and scope

`pi-usage` is a Pi Coding Agent extension package for subscription quota
readouts, not an application or an inference client. Keep pi-tokometer code,
token counting, and inference-cost tracking out of this package. It has its own Git
repository even when nested in another workspace. Run Git and validation
commands here; do not stage its files in the parent repository.

The npm package remains private; installation supports GitHub and local
checkouts. Do not publish, change release metadata, or mutate remote repositories
without an explicit request. Preserve unrelated working-tree changes.

## Layout

- `extensions/usage/index.ts` — Pi lifecycle, commands, polling, cancellation,
  provider state, footer-status visibility, and deduplicated critical notifications.
- `src/quota.ts` — quota types, response parsing, concern thresholds, usage
  readouts, and detail formatting. Keep parsing and formatting testable without
  Pi or live credentials.
- `src/sources.ts` — provider authentication, fixed-origin transport, response
  limits, and owner-only Ollama cookie-file validation.
- `test/*.test.ts` — Node tests with invented credentials and mocked transport.
- `README.md` — user-facing setup, commands, limitations, and safety behavior.
- `package.json` — version source of truth, Pi extension manifest, and package
  file allowlist. Tests and this guide are checkout-only, not installable contents.
- `CHANGELOG.md` — versioned checkpoints and pending changes; included in the
  installable package.

## Version tracking

The development baseline is `0.0.1`. While experimental, use patch increments
within `0.0.x` for explicitly requested versioned checkpoints. Keep the version
in `package.json`, the README's current version, and `CHANGELOG.md` aligned.
Record pending user-visible changes under `Unreleased`; move them into a dated
version entry when making a checkpoint. Run all validation before a checkpoint.
Do not automatically bump the version for every edit, create Git tags, publish,
or mutate remotes without an explicit request.

## Release shorthand

When the user directly instructs **"ship it"**, treat it as
explicit authorization for the following workflow in this repository. Merely
quoting or discussing the phrase is not authorization.

1. Review the working tree and diff. Include the intended pi-usage changes;
   preserve unrelated work and ask if release scope is ambiguous. Check the
   branch and remote; do not force-push or discard changes.
2. Increment the experimental patch version (`0.0.x`) unless the user specifies
   another version. Align `package.json`, README, and CHANGELOG; move Unreleased
   notes into a dated entry for the new version.
3. Run `npm test`, `npm run pack:check`, and `git diff --check`. Stop on failure.
   Keep tests offline; this instruction does not authorize live quota checks.
4. Commit the release changes, create an annotated `v<version>` Git tag at that
   commit, and push the branch and that specific tag to the verified GitHub
   remote. Never move or overwrite an existing release tag.
5. Create a GitHub Release for that tag using the version's changelog notes
   (prefer `gh release create` with `--verify-tag`). Do not publish to npm.
   If GitHub authentication or permissions are unavailable, report the blocker;
   do not read or print credentials. Report partial completion rather than
   claiming a release succeeded.
6. Report version, commit, tag, release URL, validation, and final working-tree
   status. Do not automatically run package updates on users' installations.

Git tags identify immutable version checkpoints; GitHub Releases attach notes
to those tags. Pi does not select versions from GitHub Releases. Unpinned GitHub
installs follow the default branch when updated with `pi update <source>` or
`pi update --extensions`; tag/commit-pinned installs remain pinned. Users reload
existing sessions after updating. Local-path installs load their checkout and
require updating that checkout separately, then reloading.

## Behavior to preserve

- Poll both implemented providers independently of the selected model; model
  switches preserve snapshots and do not force additional requests.
- GPT parses 5h and weekly windows by duration (18,000 and 604,800 seconds),
  never field position. One malformed window must not hide another valid one.
- Ollama parses monthly included credits, not top-ups or model prices.
- Footer follows provider selection: GPT for `openai`/`openai-codex`, OLM for
  `ollama-cloud` or `ollama` IDs ending in `:cloud`/`-cloud`, hidden otherwise.
  GPT shows `GPT: 27% ↻5h · 27% ↻6d` (5h then weekly); Ollama shows
  `OLM: 06% ↻29d` (monthly). Show used percentages padded to at least two digits.
  Color percentages using unrounded values; labels and reset countdowns remain
  dim at rest. On model switch, cut to theme foreground then fade to normal;
  warning/error digits stay unchanged. Animation never fetches. Short-window
  countdowns go from `1h` directly to `59m`, never `60m`. GPT 5h and Ollama
  monthly windows also show a pace marker (`▲`) derived only from observed
  percentage and elapsed window time: `accent` when projected above 100%
  before reset, `warning` above 150%, hidden during the first 5% of a window
  and after reset. The monthly window is the calendar month before its reset
  date. Never present pace as provider policy or a real forecast. No bars or
  view modes.
- `/usage` shows details, `/usage refresh` explicitly refreshes, and
  `/usage footer` only toggles visibility. Hiding does not stop polling,
  suppress critical notifications, clear snapshots, or block detail commands.
  `/ollama-usage` is a compatibility alias. Visibility defaults to shown after
  reload or session replacement.
- Use `ctx.ui.setStatus` in Pi's standard footer status row, not a widget or
  replacement footer. Clear the status when hidden and on shutdown. Let Pi
  handle shared-row truncation in narrow terminals. Guard UI-only behavior;
  do not inject quota details or authentication diagnostics into model context.
- Missing or invalid data is unavailable, never zero usage. Expired snapshots
  stay visibly expired; stale values are marked. Failed refreshes discard only
  the affected provider's snapshot.
- Keep the README threshold table and command list aligned with implementation.
  Thresholds are UI heuristics, not provider policy or time-aware forecasts.

## Authentication and safety

- Never read real credentials, browser storage, or private cookie files for
  routine development. Never put secrets or real account responses in source,
  fixtures, logs, documentation, or session messages.
- Prefer Pi's modern `openai` authentication only when its source is OAuth;
  otherwise resolve legacy `openai-codex`. Never send ordinary OpenAI API keys
  to ChatGPT, or fall back to another account after modern OAuth failure.
- Ollama uses an explicitly supplied owner-only website cookie file; inference
  keys and `ollama signin` are not substitutes.
- Preserve fixed HTTPS origins, refused redirects, sanitized errors, the
  15-second deadline, and the 1 MiB response cap. Never log response bodies or
  raw authentication failures.
- Start timers only in UI sessions, not extension factories. Coalesce pending
  refreshes, throttle automatic requests, and cancel work on reload/shutdown.
- Warning markers contain only hashed filenames and no account or usage data.
- Live checks require explicit authorization. Quota requests are not inference,
  but still access credentials and private account data. No live calls are
  needed for routine validation. Do not edit `.pi/` state as implementation.

## Pi API authority

Use the installed `@earendil-works/pi-coding-agent` documentation and examples,
not remembered or stale online APIs. In this development environment it is at
`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/`; resolve the
installed package location if working elsewhere.

Read applicable Markdown files completely and follow relevant cross-references
before implementing Pi-specific behavior: `docs/extensions.md` for lifecycle
and commands, `docs/tui.md` for status rendering, and `docs/packages.md` for
packaging. Consult `examples/extensions/` for current implementations.

## Validation and handoff

From this directory, using Node.js 22.18+ or a newer release with TypeScript
type stripping enabled by default:

```sh
npm test
npm run pack:check
git diff --check
```

Keep tests offline with invented data and mocked transport. Cover changed
parsers, threshold boundaries, formatting, command behavior, failure isolation,
and cancellation as applicable. `pack:check` is a dry run, not a release.

Report files changed, validation results, unresolved assumptions, and whether
any network request, real credential access, live API call, or remote mutation
occurred. Do not claim mocked tests verify live upstream compatibility.
