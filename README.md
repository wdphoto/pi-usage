# pi-usage

Cloud subscription quota status for Pi, following the selected provider:

```text
GPT: 27% ↻5h · 27% ↻6d
```

For Ollama Cloud instead:

```text
OLM: 06% ↻29d
```

GPT shows the 5-hour allowance first, then the weekly allowance. OLM shows
Ollama's monthly allowance. Percentages are padded to at least two digits.
There is one layout; `/usage footer` toggles its visibility without stopping
polling or critical notifications. Usage appears in Pi's standard footer
status row alongside other extension statuses. GPT appears for `openai` or
`openai-codex`; OLM appears for `ollama-cloud`, or `ollama` models whose IDs
end in `:cloud` or `-cloud`. Local Ollama models, other providers, and no
selected model show no usage status. Percentages show **used** quota.
Only percentages and pace markers change color; labels and countdowns remain
dim.

A projected-pace marker (`▲`) follows the GPT 5h and Ollama monthly
percentages: `accent` when the observed rate would exceed the allowance before
reset (warm), and `warning` above 150% projected (hot). Projections start after
the first 5% of a window (15 minutes for 5h, about 1.5 days for Ollama's
monthly window) and stop after reset. The monthly window is the calendar month
before the reset date. The projection is a linear extrapolation from the last
observed percentage—not a provider forecast—so stale data is marked `~` and the
marker reflects that observation. Weekly quotas have no pace marker. `/usage`
adds the projected percentage when it applies.

Switching models cuts the active provider's status to the theme's foreground
(white in dark themes), holds briefly, then fades smoothly to its normal colors
within one second. Warning and critical percentages stay unchanged throughout;
there is no blinking or ongoing pulse. Fade frames repaint cached snapshots
only: no request, credential resolution, or context change. Hidden footers,
local or unrelated models, and shutdown stop the animation.

| Window | Accent / watch | Warning / caution | Error / critical |
| --- | --- | --- | --- |
| GPT 5h | 80% | 90% | 100% |
| GPT weekly | 70% | 85% | 95% |
| Ollama monthly | 70% | 85% | 95% |

These are UI heuristics, not provider-defined limits or time-aware spending
forecasts. Colors use unrounded percentages; displayed percentages round to
whole numbers, so a rounded percentage can appear to reach a threshold before
its color changes. Critical usage warns once per known account/window/reset
period when a future reset timestamp is available. The pace marker is an
estimate, not provider policy.
Reset days round up; the 5h countdown uses rounded-up hours, switching directly
from `1h` to `59m` when rounded-up minutes reach 59 (never `60m`). Percentages to one decimal place and full reset timestamps remain
in `/usage`.
Pi may truncate the shared status row in narrow terminals.

Uses `setStatus`, not a widget or `setFooter`, so Pi's default footer and other
extension statuses remain intact.

## Scope and versioning

This package tracks subscription quotas only. It does not include pi-tokometer
code, token counting, inference-cost tracking, or a replacement footer.

The current development version is **v0.0.3**. `package.json` is the version
source of truth; changes are tracked in [CHANGELOG.md](CHANGELOG.md). While
experimental, versioned checkpoints increment the patch number (`0.0.x`).
Versioning does not imply npm publication; the package remains private.

## Provider support

| Priority | Provider | Current implementation |
| --- | --- | --- |
| 1 | ChatGPT / OpenAI Codex | 5h and weekly Codex quotas via Pi's `openai` ChatGPT OAuth, with legacy `openai-codex` fallback |
| 2 | Ollama Cloud | Monthly included credits via an explicitly supplied website cookie file |

ChatGPT here means **Codex subscription usage**, not every model's ChatGPT web
chat allowance. The 5h and weekly windows are identified by duration (18,000
and 604,800 seconds), not guessed from field order. Missing or invalid windows
show unavailable independently; a valid window is preserved if the other is
missing or malformed.

Both implemented adapters are checked regardless of the selected model.
Each snapshot belongs to its authenticated provider account, not the active
model. Providers without implemented adapters are omitted; no OpenCode
requests are made.

These are private upstream interfaces, not guaranteed public billing APIs.
Adapters are implemented and mock-tested. Ollama monthly quota and an exact
future reset timestamp have also been verified with an authorized live website
session; account data is not retained in this package. Missing or invalid data
displays `unavailable`, never zero usage. Initial checks show `loading` (or
`pending` before starting). Reset-expired data displays `expired`; failed
refreshes discard only that provider's snapshot rather than risk showing
another account's cached quota. Stale data is marked `~`. Model switches do
not clear snapshots or trigger extra requests.

## Install

Requires Pi 0.85.1-compatible extension APIs. For the development commands
below, use Node.js 22.18+ or a newer release with TypeScript type stripping
enabled by default.

```sh
pi install git:github.com/wdphoto/pi-usage
```

Then run `/reload` in each existing Pi session. Both providers are polled in UI sessions even when neither is
selected. No inference is performed. See [Authentication](#authentication)
for setup; without usable credentials, the affected provider shows unavailable.

## Authentication

### ChatGPT

Use Pi's `/login openai` and choose **Sign in with ChatGPT**, not the API-key
option. Current Pi stores this subscription login under `openai`; older Pi
used `openai-codex` (now labeled legacy). The extension prefers `openai` auth
only when Pi identifies its source as OAuth. Otherwise it checks the legacy
`openai-codex` login. Ordinary OpenAI API keys are never sent to ChatGPT.

Authentication is resolved through Pi's model registry, which can refresh OAuth
credentials. The extension does not read browser cookies or directly parse
`auth.json`. Only the bearer token and account header needed for the fixed
ChatGPT usage origin are sent. Account headers take precedence over account IDs
extracted from token claims. Failed modern OAuth resolution or quota requests
do not fall back to a different legacy account.

The new login uses a different, API-scoped OAuth grant. Provider selection and
transport are mock-tested, but acceptance of that grant by the private
`wham/usage` endpoint has not been live-verified by this package. A rejection
(HTTP 401/403) now reports possible token-scope incompatibility instead of
instructing you to sign in again. This is not proof that inference auth is
broken. Pi itself links new-login usage-limit errors to
https://chatgpt.com/settings/usage. The 5h and weekly window parsers are
mock-tested, but have not been live-validated by this package against the new
subscription-sharing allowance.

OpenAI's documented [Usage and Costs APIs](https://developers.openai.com/cookbook/examples/completions_usage_api)
report organization API activity using an Admin API key. They are not a verified
replacement for ChatGPT subscription quota, and this extension does not request
an Admin key or substitute organization token counts for subscription percentages.

### Ollama

The website session is separate from `ollama signin`. The current adapter uses
`https://ollama.com/settings`; an inference API key is not substituted for a
website cookie.

Provide the **Cookie header value** for your own signed-in Ollama account in an
owner-only file outside repositories. The default path is
`~/.config/pi-usage/ollama.cookie`; run `/reload` after updating the extension,
then `/usage refresh` after supplying or renewing the cookie. Alternatively,
set `PI_USAGE_OLLAMA_COOKIE_FILE` to an absolute path **before launching Pi**.
Restrict the file to mode `600` and its parent directory to mode `700`.
The file should contain one line such as `session=...` using the actual cookie
names your website session supplies. Do not include the `Cookie:` prefix.

Treat the cookie like a password. Never paste it into chat, command-line
arguments, Git, or a shared HAR. Use a local editor or secret manager to populate
the private file. The extension does not extract cookies from browsers or
Keychain. Renew the file if the website session expires. No credential value is
logged, saved in session messages, or copied into this package.

If cookie setup is not desired, Ollama shows `unavailable` until another
verified account authentication method is implemented. Do not mistake that for working live
monthly quota tracking.

## Commands

- `/usage`: all providers' valid quotas or diagnostic statuses, percentages
  to one decimal place,
  used/allowed credits where available, reset timestamps, and last refresh.
- `/usage refresh`: explicitly refresh both implemented adapters.
- `/usage footer`: toggle the footer readout shown/hidden. No arguments or
  view modes. This does not fetch, clear snapshots, or change polling;
  `/usage` and `/usage refresh` still work while hidden. Visibility is
  runtime-only; reload or session replacement restores shown.
- `/ollama-usage`: compatibility alias; accepts the same arguments and shows
  all providers.

Use Pi `/config` to disable the extension persistently, including polling.
The former `view`, `toggle`, `on`, and `off` subcommands are no longer supported.

Detail output is UI-only, not injected into LLM context. It includes every
valid GPT window returned, plus the pace projection when a 5h or monthly
window has enough history. Per-model request-count breakdowns and quota
windows other than GPT 5h/weekly and Ollama monthly are not parsed yet.

## Refresh and safety

- Only UI sessions poll: checks every 30 seconds, fetches at most once per fifteen
  minutes automatically per provider. Explicit refresh can bypass that interval.
- One request at a time per provider, with independent parallel refreshes and
  failures. Overlapping refreshes share pending work. Reload and shutdown cancel
  requests; model switches do not.
- A 15-second deadline and 1 MiB response cap; redirects are refused.
- Fixed HTTPS origins only. No inference calls, billing changes, or browser
  automation. Background factories do not open timers.
- Snapshots stay in memory. Warning markers are hashed filenames beneath
  `~/.cache/pi-usage/warnings` (override with `PI_USAGE_STATE_DIR`). They contain
  no account IDs, tokens, amounts, or response bodies. Exclusive creation avoids
  duplicate warnings across panes. Renewing an Ollama cookie can repeat a warning
  because the private identity hash changes. Unknown reset dates cannot support
  a durable per-period warning and therefore only receive critical status color.
- Errors never include upstream response bodies or raw auth failures.

## Validation

```sh
npm test
npm run pack:check
git diff --check
```

Tests use invented data and mocked transport, including persistent multi-provider
snapshots, selected-provider footer status, switch fade settling and steady
warning digits, failure isolation, refresh throttling, provider switching,
5h/weekly-window selection in either field order, monthly-credit parsing,
period-specific thresholds, reset dates, zero-padded readouts, 5h and monthly
pace projection and marker colors, footer toggling
without stopping refreshes, removed-command rejection,
invalid data, cookie permissions, redirects, bounded responses, shutdown,
current ChatGPT OAuth selection, API-key exclusion, legacy fallback, and
no account fallback after modern authentication failures.
Tests require the host-provided `@earendil-works/pi-tui` peer to be resolvable
locally (a link to Pi's installed copy is sufficient); no live provider call
is required. Cookie tests use
invented owner-only files in temporary directories, never your real cookie.
`pack:check` inspects the package contents without publishing.

For contributors, the checkout's `AGENTS.md` contains development guidance
and safety requirements; it is not included in the installable package.

## Evidence

Interface discovery (independent implementation, no upstream code copied):

- [CodexBar Codex usage fetcher](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthUsageFetcher.swift)
  — `GET https://chatgpt.com/backend-api/wham/usage`, bearer auth and account ID.
- [CodexBar Ollama fetcher](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Ollama/OllamaUsageFetcher.swift)
  — authenticated Ollama settings page.
- [CodexBar Ollama parser](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Ollama/OllamaUsageParser.swift)
  — monthly-credit text and `data-time` reset timestamp.
- [Ollama pricing](https://ollama.com/pricing) and
  [authentication documentation](https://docs.ollama.com/api/authentication).
- [Historical visual inspiration](https://github.com/satas20/opencode-todo-progress)
  — informed an earlier bar-based layout; the current usage line uses digits only.
