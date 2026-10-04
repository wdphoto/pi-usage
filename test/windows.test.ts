import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChatGPTWindows, statusSummary, colorFor, details } from "../src/quota.ts";

const now = Date.parse("2030-01-01T00:00:00Z");
const short = { limit_window_seconds: 18000, used_percent: 90, reset_at: (now + 2 * 3600000) / 1000 };
const weekly = { limit_window_seconds: 604800, used_percent: 72, reset_at: (now + 4 * 86400000) / 1000 };
const plain = (_c: string, s: string) => s;

test("both GPT windows are selected by duration, in either order, with independent invalid data", () => {
  for (const windows of [[short, weekly], [weekly, short]]) {
    const quotas = parseChatGPTWindows({ rate_limit: { primary_window: windows[0], secondary_window: windows[1] } }, now);
    assert.deepEqual(quotas.map(q => [q.period, q.percent]), [["5h", 90], ["weekly", 72]]);
    assert.match(details(quotas[0]), /5-hour/);
  }
  assert.equal(parseChatGPTWindows({ rate_limit: { primary_window: short } }, now)[0].period, "5h");
  assert.equal(parseChatGPTWindows({ rate_limit: { primary_window: { ...short, used_percent: -1 }, secondary_window: weekly } }, now)[0].period, "weekly");
  assert.throws(() => parseChatGPTWindows({ rate_limit: { primary_window: { ...short, used_percent: "90" } } }, now));
  assert.throws(() => parseChatGPTWindows({}));
});

test("slim digits-only readout, expired windows and minute countdowns", () => {
  const quotas = parseChatGPTWindows({ rate_limit: { primary_window: short, secondary_window: weekly } }, now);
  const states = { chatgpt: { quotas }, ollama: { error: "missing" } };
  assert.equal(statusSummary(states, plain, now), "GPT: 90% ↻2h · 72% ↻4d | OLM: unavailable");
  assert.match(statusSummary(states, plain, now + 90 * 60000), /~90% ↻30m/);
  assert.match(statusSummary(states, plain, now + 2 * 3600000), /expired · ~72%/);
  assert.equal(statusSummary({ chatgpt: { quotas: quotas.map(q => ({ ...q, percent: 27, resetAt: now + (q.period === "5h" ? 5 * 3600000 : 6 * 86400000) })) },
    ollama: { quota: { provider: "ollama", period: "monthly", percent: 6, observedAt: now, resetAt: now + 29 * 86400000 } } }, plain, now),
    "GPT: 27% ↻5h · 27% ↻6d | OLM: 06% ↻29d");
  assert.match(statusSummary({ chatgpt: {}, ollama: { quota: { provider: "ollama", period: "monthly", percent: 0, observedAt: now } } }, plain, now), /OLM: 00%$/);
  const colors: [string, string][] = [];
  statusSummary(states, (c, s) => { colors.push([c, s]); return s; }, now);
  assert(colors.some(([c, s]) => c === "warning" && s === "90%"));
  assert(colors.some(([c, s]) => c === "accent" && s === "72%"));
});

test("period-specific concern thresholds use unrounded percentages", () => {
  assert.deepEqual([79.9, 80, 89.9, 90, 99.9, 100, 120].map(p => colorFor(p, "5h")),
    ["dim", "accent", "accent", "warning", "warning", "error", "error"]);
  for (const period of ["weekly", "monthly"] as const) {
    assert.deepEqual([69.9, 70, 84.9, 85, 94.9, 95].map(p => colorFor(p, period)),
      ["dim", "accent", "accent", "warning", "warning", "error"]);
  }
});
