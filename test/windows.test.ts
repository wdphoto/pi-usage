import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChatGPTWindows, statusSummary, colorFor, details, paceFor, calendarMonthStart, type Quota } from "../src/quota.ts";

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
  assert.equal(statusSummary(states, plain, now), "GPT: 90% ↻2h ▲ · 72% ↻4d | OLM: unavailable");
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

test("hour countdown transitions directly from 1h to 59m, never 60m", () => {
  for (const [remaining, expected] of [
    [3 * 3600000, "3h"], [2 * 3600000, "2h"],
    [3600000 + 1, "2h"], [3600000, "1h"],
    [3600000 - 1, "1h"], [59 * 60000 + 1, "1h"],
    [59 * 60000, "59m"], [58 * 60000 + 1, "59m"],
    [58 * 60000, "58m"], [60000, "1m"], [1, "1m"],
  ] as const) {
    const quotas = parseChatGPTWindows({ rate_limit: { primary_window: { ...short, reset_at: (now + remaining) / 1000 } } }, now);
    assert.match(statusSummary({ chatgpt: { quotas }, ollama: {} }, plain, now), new RegExp(`↻${expected}(?: ▲)? ·`));
  }
});

test("5h pace projects linearly, staying quiet until the sample is meaningful", () => {
  const quota = (percent: number, elapsed: number, period: Quota["period"] = "5h"): Quota =>
    ({ provider: period === "5h" ? "chatgpt" : "ollama", period, percent, observedAt: now, resetAt: now + 18_000_000 - elapsed });
  assert.equal(paceFor(quota(20, 4 * 3600000), now), undefined, "on pace");
  assert.equal(paceFor(quota(20, 3600000), now), undefined, "exactly on pace");
  assert.deepEqual(paceFor(quota(21, 3600000), now), { level: "warm", projected: 105 });
  assert.deepEqual(paceFor(quota(60, 2 * 3600000), now), { level: "warm", projected: 150 });
  assert.deepEqual(paceFor(quota(70, 2 * 3600000), now), { level: "hot", projected: 175 });
  assert.equal(paceFor(quota(90, 10 * 60000), now), undefined, "needs 15 minutes of history");
  assert.equal(paceFor(quota(90, 3600000, "weekly"), now), undefined, "5h only");
  assert.equal(paceFor({ ...quota(90, 3600000), resetAt: undefined }, now), undefined);
  assert.equal(paceFor({ ...quota(99, 3600000), observedAt: now - 4 * 3600000 }, now), undefined, "observation before window start");
  assert.equal(paceFor({ ...quota(99, 3600000), resetAt: now - 1000 }, now), undefined, "expired");
});

test("footer pace markers are additive and colored by level", () => {
  const quota = (percent: number, elapsed: number): Quota =>
    ({ provider: "chatgpt", period: "5h", percent, observedAt: now, resetAt: now + 18_000_000 - elapsed });
  const plain = (_c: string, s: string) => s;
  assert.equal(statusSummary({ chatgpt: { quotas: [quota(21, 3600000)] }, ollama: {} }, plain, now), "GPT: 21% ↻4h ▲ · unavailable | OLM: pending");
  assert.equal(statusSummary({ chatgpt: { quotas: [quota(70, 2 * 3600000)] }, ollama: {} }, plain, now), "GPT: 70% ↻3h ▲ · unavailable | OLM: pending");
  const colors: [string, string][] = [];
  statusSummary({ chatgpt: { quotas: [quota(70, 2 * 3600000)] }, ollama: {} }, (c, s) => { colors.push([c, s]); return s; }, now);
  assert(colors.some(([c, s]) => c === "warning" && s === " ▲"));
  statusSummary({ chatgpt: { quotas: [quota(21, 3600000)] }, ollama: {} }, (c, s) => { colors.push([c, s]); return s; }, now);
  assert(colors.some(([c, s]) => c === "accent" && s === " ▲"));
  const realNow = Date.now();
  const fresh: Quota = { provider: "chatgpt", period: "5h", percent: 70, observedAt: realNow, resetAt: realNow + 3 * 3600000 };
  assert.match(details(fresh), /Pace: hot — projected 175\.0%/);
  assert.doesNotMatch(details(quota(21, 3600000)), /Pace:/, "fixed 2030 timestamps are future-dated; no projection");
});

test("monthly pace uses the calendar month before reset and the same heat levels", () => {
  const jan17 = Date.parse("2030-01-17T00:00:00Z");
  const feb1 = Date.parse("2030-02-01T00:00:00Z"); // 31-day window from Jan 1
  const monthly = (percent: number, observedAt: number): Quota =>
    ({ provider: "ollama", period: "monthly", percent, observedAt, resetAt: feb1 });
  assert.deepEqual(paceFor(monthly(60, jan17), jan17), { level: "warm", projected: 60 * 31 / 16 });
  assert.deepEqual(paceFor(monthly(80, jan17), jan17), { level: "hot", projected: 80 * 31 / 16 });
  assert.equal(paceFor(monthly(30, jan17), jan17), undefined, "under pace");
  const early = Date.parse("2030-01-01T12:00:00Z");
  assert.equal(paceFor(monthly(90, early), early), undefined, "first 5% of the window");
  // Calendar starts stay inside the target month instead of rolling into the next one.
  const start = (iso: number) => new Date(calendarMonthStart(iso));
  const feb = start(Date.parse("2030-03-31T02:00:00Z"));
  assert.equal(feb.getMonth(), 1, "no rollover into March");
  assert(feb.getDate() >= 27 && feb.getDate() <= 29, "clamped near month end");
  const dec = start(Date.parse("2030-01-31T02:00:00Z"));
  assert.equal(dec.getFullYear(), 2029);
  assert.equal(dec.getMonth(), 11, "no rollover into January");
  assert.equal(start(Date.parse("2030-03-28T02:00:00Z")).getMonth(), 1);
  const plain = (_c: string, s: string) => s;
  assert.equal(statusSummary({ chatgpt: {}, ollama: { quota: monthly(60, jan17) } }, plain, jan17, ["ollama"]), "OLM: 60% ↻15d ▲");
  const colors: [string, string][] = [];
  statusSummary({ chatgpt: {}, ollama: { quota: monthly(80, jan17) } }, (c, s) => { colors.push([c, s]); return s; }, jan17, ["ollama"]);
  assert(colors.some(([c, s]) => c === "warning" && s === " ▲"));
  const realNow = Date.now();
  const fresh: Quota = { provider: "ollama", period: "monthly", percent: 60, observedAt: realNow, resetAt: realNow + 15 * 86400000 };
  assert.match(details(fresh), /Pace: warm/);
});

test("period-specific concern thresholds use unrounded percentages", () => {
  assert.deepEqual([79.9, 80, 89.9, 90, 99.9, 100, 120].map(p => colorFor(p, "5h")),
    ["dim", "accent", "accent", "warning", "warning", "error", "error"]);
  for (const period of ["weekly", "monthly"] as const) {
    assert.deepEqual([69.9, 70, 84.9, 85, 94.9, 95].map(p => colorFor(p, period)),
      ["dim", "accent", "accent", "warning", "warning", "error"]);
  }
});
