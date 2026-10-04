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
  const notifications: string[] = [];
  const ctx: any = { hasUI: true, model: { provider: "openai-codex", id: "test" },
    ui: { setStatus: (key: string, status: string | undefined) => {
        assert.equal(key, "pi-usage");
        statuses.push(status);
      },
      setWidget() { assert.fail("usage must use the standard footer status row"); },
      setFooter() { assert.fail("usage must not replace Pi's footer"); }, theme: { fg: (_c: string, s: string) => s }, notify(message: string) { notifications.push(message); } },
    modelRegistry: { async getProviderAuth() { return { auth: { apiKey: "invented" } }; } } };
  const commands = new Map<string, any>();
  extension({ on: (n: string, h: Function) => events.set(n, h), registerCommand: (n: string, c: any) => commands.set(n, c) } as any);
  const settled = async () => {
    for (let n = 0; n < 100 && /loading|pending/.test(statuses.at(-1) ?? ""); n++) await new Promise(r => setTimeout(r, 5));
    assert.doesNotMatch(statuses.at(-1)!, /loading|pending/);
  };
  try {
    events.get("session_start")!({}, ctx);
    await commands.get("usage").handler("", ctx);
    await settled();
    const expected = "GPT: unavailable · 40% ↻7d";
    assert.equal(statuses.at(-1), expected);
    for (const [model, status] of [
      [{ provider: "ollama-cloud", id: "example" }, "OLM: 15% ↻7d"],
      [{ provider: "ollama", id: "example:cloud" }, "OLM: 15% ↻7d"],
      [{ provider: "ollama", id: "local:8b" }, undefined],
      [{ provider: "opencode", id: "test" }, undefined],
      [{ provider: "openai", id: "test" }, expected],
      [{ provider: "openai-codex", id: "test" }, expected],
    ] as const) {
      ctx.model = model;
      events.get("model_select")!({}, ctx);
      assert.equal(statuses.at(-1), status);
    }
    assert.equal(calls.length, 2);
    await commands.get("usage").handler("", ctx);
    assert.match(notifications.at(-1)!, /ChatGPT \/ Codex/);
    assert.match(notifications.at(-1)!, /Ollama monthly/);
    assert.equal(calls.length, 2);
    await commands.get("usage").handler("footer", ctx);
    assert.equal(statuses.at(-1), undefined);
    await commands.get("usage").handler("", ctx);
    assert.equal(calls.length, 2);
    events.get("model_select")!({}, ctx);
    events.get("agent_settled")!({}, ctx);
    assert.equal(statuses.at(-1), undefined);
    await commands.get("usage").handler("refresh", ctx);
    assert.equal(statuses.at(-1), undefined);
    assert.equal(calls.length, 4);
    await commands.get("usage").handler("footer", ctx);
    assert.equal(statuses.at(-1), expected);
    assert.equal(calls.length, 4);
    for (const removed of ["view", "view full", "footer on", "toggle", "on", "off"]) {
      await commands.get("usage").handler(removed, ctx);
      assert.equal(statuses.at(-1), expected);
      assert.equal(calls.length, 4);
    }
    failGPT = true;
    await commands.get("usage").handler("refresh", ctx);
    assert.equal(calls.length, 6);
    assert.equal(statuses.at(-1), "GPT: unavailable");
    ctx.model = { provider: "ollama-cloud", id: "example" };
    events.get("model_select")!({}, ctx);
    assert.equal(statuses.at(-1), "OLM: 15% ↻7d");
    assert.equal(calls.length, 6);
  } finally {
    events.get("session_shutdown")!({}, ctx);
    assert.equal(statuses.at(-1), undefined);
    globalThis.fetch = originalFetch;
    if (previousEnv === undefined) delete process.env.PI_USAGE_OLLAMA_COOKIE_FILE;
    else process.env.PI_USAGE_OLLAMA_COOKIE_FILE = previousEnv;
    await rm(dir, { recursive: true, force: true });
  }
});
