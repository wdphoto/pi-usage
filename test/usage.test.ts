import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../extensions/usage/index.ts";
import { footer, colorFor, parseChatGPT, parseOllama, providerFor, formatDate, statusSummary } from "../src/quota.ts";
import { boundedText, loadQuota, readCookie, URLS } from "../src/sources.ts";

const now = Date.parse("2030-09-01T12:00:00Z");
const reset = Date.parse("2030-10-01T12:00:00Z");
const payload = { rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 99 }, secondary_window: { limit_window_seconds: 604800, used_percent: 40, reset_at: reset / 1000 } } };
const html = `<h2>Monthly usage</h2><p>$12.00 of $80 used</p><span data-time="2030-10-01T12:00:00Z">Resets soon</span><h2>Models used this month</h2>`;

test("routes quota by provider, never by OpenAI model name alone", () => {
  assert.equal(providerFor({ provider: "openai-codex", id: "anything" }), "chatgpt");
  assert.equal(providerFor({ provider: "openai", id: "gpt-5" }), undefined);
  assert.equal(providerFor({ provider: "ollama", id: "example:cloud" }), "ollama");
  assert.equal(providerFor({ provider: "ollama", id: "local:8b" }), undefined);
  assert.equal(providerFor({ provider: "opencode", id: "example" }), undefined);
});
test("ChatGPT selects weekly by duration, not window position", () => {
  assert.equal(parseChatGPT(payload, now).percent, 40);
  assert.equal(parseChatGPT({ rate_limit: { primary_window: payload.rate_limit.secondary_window } }, now).percent, 40);
  assert.throws(() => parseChatGPT({ rate_limit: { primary_window: payload.rate_limit.primary_window } }));
  for (const value of [null, -1, "40", NaN, Infinity]) {
    assert.throws(() => parseChatGPT({ rate_limit: { secondary_window: { ...payload.rate_limit.secondary_window, used_percent: value } } }));
  }
});
test("Ollama parses actual monthly credits and exact reset; no date invention", () => {
  const q = parseOllama(html, now);
  assert.equal(q.percent, 15); assert.equal(q.resetAt, reset);
  assert.equal(parseOllama("Monthly usage $1,000 of $2,000 used Resets in 3 weeks", now).percent, 50);
  assert.equal(parseOllama("Monthly usage $1 of $20 used Resets in 3 weeks", now).resetAt, undefined);
  assert.throws(() => parseOllama("Sign in to Ollama"));
  assert.throws(() => parseOllama("Monthly usage $1 of $0 used"));
  assert.throws(() => parseOllama("Monthly usage Models used this month $1 of $10 used"));
});
test("compact shaded bar, dates, thresholds, overage, unknown and expired", () => {
  const q = parseChatGPT(payload, now);
  const plain = (_c: string, s: string) => s;
  assert.equal(footer(q, plain, false, now), "CG ■■□□□ 40% ↻30d");
  assert.equal(footer(undefined, plain, false, now), "?");
  assert.equal(footer({ ...q, resetAt: now + 3600000 }, plain, false, now), "CG ■■□□□ 40% ↻1d");
  assert.equal(footer({ ...q, provider: "ollama", resetAt: undefined }, plain, false, now), "🦙 ■■□□□ 40%");
  assert.equal(footer({ ...q, resetAt: now }, plain, false, now), "?");
  assert.equal(footer({ ...q, percent: 120 }, plain, false, now), "CG ■■■■■ 120% ↻30d");
  assert.equal(footer(q, plain, true, now), "CG ■■□□□ ~40% ↻30d");
  assert.deepEqual([0, 69.9, 70, 79.9, 80, 89.9, 90, 120].map(colorFor), ["dim", "dim", "accent", "accent", "warning", "warning", "error", "error"]);
});
test("transport uses only fixed ChatGPT URL, selected auth, and disables redirects", async () => {
  const ctx = { modelRegistry: { async getProviderAuth(id: string) { if (id === "openai") return undefined; assert.equal(id, "openai-codex"); return { auth: { apiKey: "invented-token", headers: { "ChatGPT-Account-Id": "invented-account" } } }; } } };
  const result = await loadQuota("chatgpt", ctx, new AbortController().signal, (async (url, init) => {
    assert.equal(url, URLS.chatgpt); assert.equal(init?.redirect, "manual");
    assert.equal((init?.headers as any)["ChatGPT-Account-Id"], "invented-account");
    return new Response(JSON.stringify(payload));
  }) as typeof fetch);
  assert.equal(result.quota.percent, 40);
  assert.match(result.identity, /^[a-f0-9]{64}$/);
});
test("current OpenAI ChatGPT OAuth takes precedence over legacy auth and derives account from JWT", async () => {
  const token = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "modern-account" } })).toString("base64url")}.signature`;
  const ctx = { modelRegistry: { async getProviderAuth(id: string) {
    assert.equal(id, "openai");
    return { source: "OAuth", auth: { apiKey: token } };
  } } };
  await loadQuota("chatgpt", ctx, new AbortController().signal, (async (_url, init) => {
    assert.equal((init?.headers as any).Authorization, `Bearer ${token}`);
    assert.equal((init?.headers as any)["ChatGPT-Account-Id"], "modern-account");
    return new Response(JSON.stringify(payload));
  }) as typeof fetch);
});
test("ordinary OpenAI keys are never sent to ChatGPT; legacy auth remains usable", async () => {
  for (const source of ["OPENAI_API_KEY", "stored", undefined]) {
    const calls: string[] = [];
    const ctx = { modelRegistry: { async getProviderAuth(id: string) {
      calls.push(id);
      return id === "openai" ? { source, auth: { apiKey: "invented-api-key" } }
        : { auth: { apiKey: "invented-legacy-token" } };
    } } };
    await loadQuota("chatgpt", ctx, new AbortController().signal, (async (_url, init) => {
      assert.equal((init?.headers as any).Authorization, "Bearer invented-legacy-token");
      return new Response(JSON.stringify(payload));
    }) as typeof fetch);
    assert.deepEqual(calls, ["openai", "openai-codex"]);
  }
});
test("missing subscription auth does not fetch and points to current login", async () => {
  const ctx = { modelRegistry: { async getProviderAuth(id: string) {
    return id === "openai" ? { source: "OPENAI_API_KEY", auth: { apiKey: "invented-key" } } : undefined;
  } } };
  await assert.rejects(loadQuota("chatgpt", ctx, new AbortController().signal,
    (async () => { assert.fail("must not fetch"); }) as typeof fetch), /\/login openai/);
});
test("modern auth failures and cancellation never fall back to another account", async () => {
  for (const mode of ["resolve", "http", "cancel"] as const) {
    const controller = new AbortController();
    const ctx = { modelRegistry: { async getProviderAuth(id: string) {
      assert.equal(id, "openai");
      if (mode === "resolve") throw new Error("invented auth failure");
      if (mode === "cancel") controller.abort();
      return { source: "OAuth", auth: { apiKey: "invented-modern-token" } };
    } } };
    await assert.rejects(loadQuota("chatgpt", ctx, controller.signal, (async () => {
      assert.equal(mode, "http");
      return new Response("private response", { status: 401 });
    }) as typeof fetch));
  }
});
test("new-login quota rejection explains scope incompatibility instead of prescribing re-login", async () => {
  const ctx = { modelRegistry: { async getProviderAuth(id: string) {
    assert.equal(id, "openai");
    return { source: "OAuth", auth: { apiKey: "invented-modern-token" } };
  } } };
  for (const status of [401, 403]) {
    await assert.rejects(loadQuota("chatgpt", ctx, new AbortController().signal,
      (async () => new Response("PRIVATE", { status })) as typeof fetch), e => {
        assert.match(String(e), /token-scope incompatibility/);
        assert.match(String(e), /https:\/\/chatgpt.com\/settings\/usage/);
        assert.doesNotMatch(String(e), /PRIVATE|sign in again/i);
        return true;
      });
  }
});
test("reject oversized responses, redirects and auth errors without body leakage", async () => {
  await assert.rejects(boundedText(new Response("abcdef"), 4), /size limit/);
  for (const status of [302, 401, 403, 429, 500]) {
    await assert.rejects(boundedText(new Response("SECRET", { status })), e => !String(e).includes("SECRET"));
  }
});
test("explicit cookie file validates permissions and rejects multiline injection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-usage-test-")); const file = join(dir, "cookie");
  try {
    await writeFile(file, "session=invented", { mode: 0o600 });
    assert.equal(await readCookie(file), "session=invented");
    await chmod(file, 0o644); await assert.rejects(readCookie(file));
    await chmod(file, 0o600); await writeFile(file, "session=invented\nInjected: true");
    await assert.rejects(readCookie(file));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("model switches retain status and shutdown prevents late updates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-usage-shutdown-"));
  const previousCookie = process.env.PI_USAGE_OLLAMA_COOKIE_FILE;
  process.env.PI_USAGE_OLLAMA_COOKIE_FILE = join(dir, "missing-cookie");
  try {
  const handlers = new Map<string, Function>(); const commands = new Map<string, any>();
  extension({ on: (n: string, fn: Function) => handlers.set(n, fn), registerCommand: (n: string, c: any) => commands.set(n, c) } as any);
  const statuses: (string | undefined)[] = [];
  let resolveAuth: Function;
  const ctx: any = { hasUI: true, model: { provider: "openai-codex", id: "test" }, ui: { setStatus: (_k: string, s: string) => statuses.push(s), theme: { fg: (_c: string, s: string) => s }, notify: () => {} }, modelRegistry: { getProviderAuth: () => new Promise(r => { resolveAuth = r; }) } };
  handlers.get("session_start")!({}, ctx);
  assert.equal(statuses.at(-1), "GPT: loading | Ollama: loading");
  ctx.model = { provider: "openai", id: "test" };
  handlers.get("model_select")!({}, ctx);
  assert.equal(statuses.at(-1), "GPT: loading | Ollama: loading");
  handlers.get("session_shutdown")!({}, ctx);
  const count = statuses.length;
  resolveAuth!({ auth: { apiKey: "invented" } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(statuses.length, count);
  assert(commands.has("usage"));
  } finally {
    if (previousCookie === undefined) delete process.env.PI_USAGE_OLLAMA_COOKIE_FILE;
    else process.env.PI_USAGE_OLLAMA_COOKIE_FILE = previousCookie;
    await rm(dir, { recursive: true, force: true });
  }
});

test("consolidated status distinguishes missing, expired and stale quotas", () => {
  const plain = (_c: string, s: string) => s;
  assert.equal(statusSummary({ chatgpt: {}, ollama: { error: "private details" } }, plain, now),
    "GPT: pending | Ollama: unavailable");
  assert.equal(statusSummary({ chatgpt: { quota: parseChatGPT(payload, now - 31 * 60000) }, ollama: { quota: { ...parseOllama(html, now), resetAt: now } } }, plain, now),
    "GPT: ■■□□□ ~40% ↻30d | Ollama: expired");
});

test("non-UI sessions do not resolve credentials or render statuses", () => {
  const handlers = new Map<string, Function>();
  extension({ on: (n: string, fn: Function) => handlers.set(n, fn), registerCommand() {} } as any);
  const ctx: any = { hasUI: false };
  handlers.get("session_start")!({}, ctx);
  handlers.get("model_select")!({}, ctx);
  handlers.get("agent_settled")!({}, ctx);
});
