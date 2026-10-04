import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { colorToRgb } from "@earendil-works/pi-tui";
import extension from "../extensions/usage/index.ts";

test("switch cuts to foreground then fades monotonically; warning digits remain steady", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-usage-fade-"));
  const previousCookie = process.env.PI_USAGE_OLLAMA_COOKIE_FILE;
  process.env.PI_USAGE_OLLAMA_COOKIE_FILE = join(dir, "missing-cookie");
  const originalFetch = globalThis.fetch;
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now });
  let calls = 0;
  let percent = 40;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ rate_limit: {
      primary_window: { limit_window_seconds: 18000, used_percent: percent, reset_at: (now + 3600000) / 1000 },
      secondary_window: { limit_window_seconds: 604800, used_percent: 40, reset_at: (now + 86400000) / 1000 },
    } }));
  }) as typeof fetch;
  const events = new Map<string, Function>();
  const commands = new Map<string, any>();
  const statuses: (string | undefined)[] = [];
  const frames: number[] = [];
  const ctx: any = { hasUI: true, model: { provider: "openai", id: "first" },
    ui: { setStatus: (_key: string, value: string | undefined) => statuses.push(value),
      theme: {
        colors: { text: { kind: "rgb", r: 255, g: 255, b: 255 }, dim: { kind: "rgb", r: 128, g: 128, b: 128 },
          accent: { kind: "rgb", r: 160, g: 160, b: 160 }, warning: { kind: "rgb", r: 200, g: 200, b: 200 } },
        fg: (color: string, text: string) => text ? `<${color}>${text}</${color}>` : "",
        style: (text: string, options: any) => {
          const { r, g, b } = colorToRgb(options.fg);
          if (text === "GPT: ") {
            assert(Math.abs(r - g) < 0.01 && Math.abs(g - b) < 0.01);
            frames.push(r);
          }
          return `<fade>${text}</fade>`;
        },
      }, notify() {} },
    modelRegistry: { async getProviderAuth() { return { source: "oauth", auth: { apiKey: "invented" } }; } } };
  extension({ on: (name: string, handler: Function) => events.set(name, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command) } as any);
  try {
    events.get("session_start")!({}, ctx);
    await commands.get("usage").handler("", ctx);
    assert.doesNotMatch(statuses.at(-1)!, /fade/);
    ctx.model = { provider: "openai", id: "second" };
    events.get("model_select")!({ source: "set" }, ctx);
    assert(Math.abs(frames.at(-1)! - 255) < 0.01);
    for (let n = 0; n < 19; n++) t.mock.timers.tick(50);
    assert(frames.at(-1)! < 140);
    for (let n = 1; n < frames.length; n++) assert(frames[n] <= frames[n - 1] + 0.01);
    t.mock.timers.tick(50);
    assert.doesNotMatch(statuses.at(-1)!, /fade/);
    assert.match(statuses.at(-1)!, /<dim>GPT: /);
    const settledCount = statuses.length;
    t.mock.timers.tick(800);
    assert.equal(statuses.length, settledCount);
    assert.equal(calls, 1);

    percent = 90;
    await commands.get("usage").handler("refresh", ctx);
    events.get("model_select")!({ source: "cycle" }, ctx);
    assert.match(statuses.at(-1)!, /<warning>90%<\/warning>/);
    assert.doesNotMatch(statuses.at(-1)!, /<fade>90%/);
    for (let n = 0; n < 20; n++) {
      t.mock.timers.tick(50);
      assert.match(statuses.at(-1)!, /<warning>90%<\/warning>/);
    }
    const warningCount = statuses.length;
    t.mock.timers.tick(800);
    assert.equal(statuses.length, warningCount);
    assert.equal(calls, 2);

    events.get("model_select")!({ source: "set" }, ctx);
    await commands.get("usage").handler("footer", ctx);
    assert.equal(statuses.at(-1), undefined);
    const hiddenCount = statuses.length;
    t.mock.timers.tick(800);
    assert.equal(statuses.length, hiddenCount);
    await commands.get("usage").handler("footer", ctx);
    assert.doesNotMatch(statuses.at(-1)!, /fade/);
    ctx.model = { provider: "ollama", id: "local:8b" };
    events.get("model_select")!({ source: "cycle" }, ctx);
    assert.equal(statuses.at(-1), undefined);
    const localCount = statuses.length;
    t.mock.timers.tick(800);
    assert.equal(statuses.length, localCount);
    ctx.model = { provider: "openai", id: "second" };
    events.get("model_select")!({ source: "restore" }, ctx);
    assert.doesNotMatch(statuses.at(-1)!, /fade/);
    events.get("model_select")!({ source: "cycle" }, ctx);
    events.get("session_shutdown")!({}, ctx);
    const shutdownCount = statuses.length;
    t.mock.timers.tick(3000);
    assert.equal(statuses.length, shutdownCount);
    assert.equal(statuses.at(-1), undefined);
  } finally {
    events.get("session_shutdown")!({}, ctx);
    t.mock.timers.reset();
    globalThis.fetch = originalFetch;
    if (previousCookie === undefined) delete process.env.PI_USAGE_OLLAMA_COOKIE_FILE;
    else process.env.PI_USAGE_OLLAMA_COOKIE_FILE = previousCookie;
    await rm(dir, { recursive: true, force: true });
  }
});
