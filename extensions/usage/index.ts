import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mixColors } from "@earendil-works/pi-tui";
import { mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { details, statusSummary, providerFor, colorFor, UsageError, type Quota, type Provider, type ProviderState } from "../../src/quota.ts";
import { loadQuota } from "../../src/sources.ts";

const KEY = "pi-usage";
const INTERVAL = 15 * 60_000;
const FADE_DURATION = 1_000;
const FLASH_HOLD = 100;
const PROVIDERS: Provider[] = ["chatgpt", "ollama"];
type State = ProviderState & { checked: number; pending?: AbortController; task?: Promise<void> };

export default function (pi: ExtensionAPI) {
  let current: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pulseTimer: ReturnType<typeof setInterval> | undefined;
  let pulseUntil = 0;
  let generation = 0;
  let footerVisible = true;
  const states: Record<Provider, State> = { chatgpt: { checked: 0 }, ollama: { checked: 0 } };
  const warned = new Set<string>();

  function paint() {
    if (!current?.hasUI) return;
    const provider = providerFor(current.model);
    const now = Date.now();
    const switching = now < pulseUntil;
    const status = footerVisible && provider
      ? statusSummary(states, (color, text) => {
        const concerned = color === "warning" || color === "error";
        const theme = current!.ui.theme;
        if (!switching || concerned || !text) return theme.fg(color, text);
        const elapsed = FADE_DURATION - (pulseUntil - now);
        const progress = Math.max(0, (elapsed - FLASH_HOLD) / (FADE_DURATION - FLASH_HOLD));
        return theme.style(text, { fg: mixColors(theme.colors.text, theme.colors[color], progress) });
      }, now, [provider])
      : undefined;
    current.ui.setStatus(KEY, status);
    // Animation only repaints cached data; it never refreshes or resolves auth.
    if (status && switching) {
      if (!pulseTimer) {
        pulseTimer = setInterval(paint, 50);
        pulseTimer.unref();
      }
    } else {
      if (pulseTimer) clearInterval(pulseTimer);
      pulseTimer = undefined;
      pulseUntil = 0;
    }
  }
  async function warn(q: Quota, identity: string, ctx: ExtensionContext, epoch: number) {
    if (colorFor(q.percent, q.period) !== "error" || !q.resetAt || q.resetAt <= Date.now()) return;
    const key = createHash("sha256").update(`${identity}:${q.period}:${q.resetAt}`).digest("hex");
    if (warned.has(key)) return;
    warned.add(key);
    // Exclusive creation deduplicates notifications across Pi panes and reloads.
    const dir = join(process.env.PI_USAGE_STATE_DIR ?? join(homedir(), ".cache", "pi-usage"), "warnings");
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      if (epoch !== generation) return;
      const f = await open(join(dir, key), "wx", 0o600);
      await f.close();
    } catch (e: any) {
      if (e?.code === "EEXIST") return;
      // In-memory deduplication still works if private persistence is unavailable.
    }
    if (epoch === generation) ctx.ui.notify(`${q.provider === "chatgpt" ? "ChatGPT / Codex" : "Ollama"}: ${q.percent.toFixed(1)}% of ${q.period} quota used. See /usage.`, "warning");
  }
  async function runRefresh(provider: Provider, ctx: ExtensionContext) {
    const state = states[provider];
    const epoch = generation;
    const controller = new AbortController();
    state.pending = controller;
    state.checked = Date.now();
    state.loading = true;
    paint();
    const deadline = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await Promise.race([
        loadQuota(provider, ctx, controller.signal),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new UsageError("Usage request timed out or was cancelled.")), { once: true })),
      ]);
      if (epoch !== generation) return;
      state.quota = result.quota; state.quotas = result.quotas; state.error = undefined;
      paint();
      for (const quota of result.quotas) await warn(quota, result.identity, ctx, epoch);
    } catch (e) {
      if (epoch !== generation) return;
      // Never expose raw transport/auth errors or retain another account's snapshot.
      state.error = e instanceof UsageError ? e.message : "Usage refresh failed. Check provider authentication and connectivity.";
      state.quota = undefined; state.quotas = undefined;
    } finally {
      clearTimeout(deadline);
      if (state.pending === controller) state.pending = undefined;
      if (epoch === generation) { state.loading = false; paint(); }
    }
  }
  async function refreshProvider(provider: Provider, force: boolean) {
    const ctx = current;
    const state = states[provider];
    if (!ctx?.hasUI) return;
    if (state.task) return state.task;
    if (!force && state.checked && Date.now() - state.checked < INTERVAL) return;
    const task = runRefresh(provider, ctx);
    state.task = task;
    try { await task; } finally { if (state.task === task) state.task = undefined; }
  }
  async function refresh(force = false) {
    await Promise.all(PROVIDERS.map(provider => refreshProvider(provider, force)));
  }
  function activate(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    current = ctx;
    paint(); void refresh();
  }
  function startTimer() {
    if (timer) return;
    timer = setInterval(() => { paint(); void refresh(); }, 30_000);
    timer.unref();
  }
  function stop() {
    generation++;
    for (const provider of PROVIDERS) {
      states[provider].pending?.abort();
      states[provider] = { checked: 0 };
    }
    if (timer) clearInterval(timer);
    timer = undefined;
    if (pulseTimer) clearInterval(pulseTimer);
    pulseTimer = undefined;
    pulseUntil = 0;
  }
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    activate(ctx);
    startTimer();
  });
  pi.on("model_select", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.source !== "restore") {
      pulseUntil = Date.now() + FADE_DURATION;
    }
    activate(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => activate(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    stop();
    current = undefined;
    ctx.ui.setStatus(KEY, undefined);
  });
  const handler = async (args: string, ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    current = ctx;
    const command = args.trim();
    if (command === "footer") {
      footerVisible = !footerVisible;
      paint();
      ctx.ui.notify(`pi-usage footer: ${footerVisible ? "shown" : "hidden"} (polling continues; until reload or session replacement).`, "info");
      return;
    }
    if (command && command !== "refresh") {
      ctx.ui.notify("Usage: /usage [refresh|footer]", "info"); return;
    }
    const epoch = generation;
    await refresh(args.trim() === "refresh");
    if (epoch !== generation) return;
    paint();
    const sections = PROVIDERS.map(provider => {
      const state = states[provider];
      return state.quotas?.length ? state.quotas.map(details).join("\n\n") : state.quota ? details(state.quota) : `${provider === "chatgpt" ? "GPT" : "Ollama"}: ${state.error ?? "Loading quota."}`;
    });
    ctx.ui.notify(sections.join("\n\n"), "info");
  };
  pi.registerCommand("usage", { description: "Cloud quotas: refresh or toggle footer", handler });
  pi.registerCommand("ollama-usage", { description: "Alias for /usage (all providers)", handler });
}
