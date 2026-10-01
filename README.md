# pi-usage

Persistent cloud subscription quota status for Pi, independent of the selected model:

```text
GPT: ■■□□□ 40% ↻7d | Ollama: ■□□□□ 15% ↻12d
```

Five squares show used quota, rounded to the nearest 20%. Filled squares
change color at the thresholds below; empty squares remain dim.
Each provider stays in the standard left-aligned footer status row, including
while using local models. Percentages show **used** quota; reset days round up.
Exact values and reset timestamps remain in `/usage`. Low usage is dim grey,
with accent at 70%, warning at 80%, and critical at 90%. At 90% it also warns
once per known account/reset period. Colors use unrounded percentages.
The host may truncate the status row in narrow terminals.

Uses `setStatus`, not `setFooter`, so other extension statuses remain intact.

## Provider support

| Priority | Provider | Current implementation |
| --- | --- | --- |
| 1 | ChatGPT / OpenAI Codex | Weekly Codex quota via Pi's `openai` ChatGPT OAuth, with legacy `openai-codex` fallback |
| 2 | Ollama Cloud | Monthly included credits via an explicitly supplied website cookie file |

ChatGPT here means **Codex subscription usage**, not every model's ChatGPT web
chat allowance. Weekly windows are identified by duration, not guessed from
field order. Accounts that return no weekly window show unavailable.

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

Requires Pi 0.85.1-compatible extension APIs and a modern Node runtime.

```sh
pi install /absolute/path/to/agent-stuff/pi-usage
```

Then run `/reload` in each existing Pi session. Both providers are polled in UI
sessions even when neither is selected. No inference is performed.

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
https://chatgpt.com/settings/usage. The existing Codex weekly parser has not
been validated against the new subscription-sharing allowance.

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

If cookie setup is not desired, Ollama shows `unavailable` until another verified account
authentication method is implemented. Do not mistake that for working live
monthly quota tracking.

## Commands

- `/usage`: all providers' quotas or diagnostic statuses, exact percentages,
  used/allowed credits where available, reset timestamps, and last refresh.
- `/usage refresh`: explicitly refresh both implemented adapters.
- `/usage toggle`: toggle the footer and background polling together.
- `/usage on` / `/usage off`: explicitly enable or disable. Off cancels pending
  requests and clears cached snapshots; on fetches fresh quotas. While off,
  `/usage` and `/usage refresh` do not fetch.
  This is runtime-only: reload or session replacement restores the default (on).
  Use Pi `/config` to disable the extension persistently.
- `/ollama-usage`: compatibility alias; also shows all providers.

Detail output is UI-only, not injected into LLM context. Per-model request-count
breakdowns and additional quota windows are deferred; they are not parsed yet.

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
```

Tests use invented data and mocked transport, including persistent multi-provider
status, failure isolation, refresh throttling, provider switching,
weekly-window selection, monthly-credit parsing, thresholds, reset dates,
invalid data, cookie permissions, redirects, bounded responses, shutdown,
current ChatGPT OAuth selection, API-key exclusion, legacy fallback, and
no account fallback after modern authentication failures.
No dependency download or live provider call is required for these tests on
Node versions supporting TypeScript type stripping.

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
- [Visual inspiration](https://github.com/satas20/opencode-todo-progress)
  — original shaded-cell inspiration; now uses filled/empty small squares.
