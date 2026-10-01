import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../extensions/usage/index.ts";

test("all quotas persist across model switches; refresh isolates provider failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-usage-switch-"));
  const file = join(dir, "cookie");
  await writeFile(file, "session=invented-test-session", { mode: 0o600 });
  const previousEnv = process.env.PI_USAGE_OLLAMA_COOKIE_FILE;
  process.env.PI_USAGE_OLLAMA_COOKIE_FILE = file;
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let failGPT = false;
  const reset = Date.now() + 7 * 86400000;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal(init.redirect, "manual");
    if (url.includes("chatgpt.com") && failGPT) return new Response("private upstream body", { status: 401 });
    if (url.includes("chatgpt.com")) return new Response(JSON.stringify({ rate_limit: {
      secondary_window: { limit_window_seconds: 604800, used_percent: 40, reset_at: Math.floor(reset / 1000) },
    } }));
    assert.equal((init.headers as any).Cookie, "session=invented-test-session");
    return new Response(`Monthly usage $12 of $80 used <span data-time="${new Date(reset).toISOString()}">reset</span>`);
  }) as typeof fetch;
  const events = new Map<string, Function>();
  const statuses: (string | undefined)[] = [];
  const ctx: any = { hasUI: true, model: { provider: "openai-codex", id: "test" },
    ui: { setStatus: (_k: string, s: string) => statuses.push(s), theme: { fg: (_c: string, s: string) => s }, notify() {} },
    modelRegistry: { async getProviderAuth() { return { auth: { apiKey: "invented" } }; } } };
  const commands = new Map<string, any>();
  extension({ on: (n: string, h: Function) => events.set(n, h), registerCommand: (n: string, c: any) => commands.set(n, c) } as any);
  const settled = async () => {
    for (let n = 0; n < 100 && /loading|pending/.test(statuses.at(-1) ?? ""); n++) await new Promise(r => setTimeout(r, 5));
    assert.doesNotMatch(statuses.at(-1)!, /loading|pending/);
  };
  try {
    events.get("session_start")!({}, ctx); await settled();
    const expected = "GPT: ■■□□□ 40% ↻7d | Ollama: ■□□□□ 15% ↻7d";
    assert.equal(statuses.at(-1), expected);
    for (const model of [{ provider: "ollama", id: "example:cloud" }, { provider: "ollama", id: "local:8b" }, { provider: "opencode", id: "test" }, { provider: "openai-codex", id: "test" }]) {
      ctx.model = model;
      events.get("model_select")!({}, ctx);
      assert.equal(statuses.at(-1), expected);
    }
    assert.equal(calls.length, 2);
    await commands.get("usage").handler("", ctx);
    assert.equal(calls.length, 2);
    await commands.get("usage").handler("off", ctx);
    assert.equal(statuses.at(-1), undefined);
    events.get("model_select")!({}, ctx);
    events.get("agent_settled")!({}, ctx);
    await commands.get("usage").handler("refresh", ctx);
    await commands.get("usage").handler("off", ctx);
    assert.equal(statuses.at(-1), undefined);
    assert.equal(calls.length, 2);
    await commands.get("usage").handler("toggle", ctx);
    await settled();
    assert.equal(statuses.at(-1), expected);
    assert.equal(calls.length, 4);
    await commands.get("usage").handler("on", ctx);
    assert.equal(calls.length, 4);
    failGPT = true;
    await commands.get("usage").handler("refresh", ctx);
    assert.equal(calls.length, 6);
    assert.equal(statuses.at(-1), "GPT: unavailable | Ollama: ■□□□□ 15% ↻7d");
  } finally {
    events.get("session_shutdown")!({}, ctx);
    globalThis.fetch = originalFetch;
    if (previousEnv === undefined) delete process.env.PI_USAGE_OLLAMA_COOKIE_FILE;
    else process.env.PI_USAGE_OLLAMA_COOKIE_FILE = previousEnv;
    await rm(dir, { recursive: true, force: true });
  }
});
