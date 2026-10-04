export type Provider = "chatgpt" | "ollama";
export type Quota = {
  provider: Provider;
  period: "5h" | "weekly" | "monthly";
  percent: number;
  resetAt?: number;
  observedAt: number;
  used?: number;
  limit?: number;
};
export class UsageError extends Error {}

export function providerFor(model?: { provider: string; id: string }): Provider | undefined {
  if (model?.provider === "openai-codex" || model?.provider === "openai") return "chatgpt";
  if (model?.provider === "ollama-cloud") return "ollama";
  if (model?.provider === "ollama" && /(?:[:\-]cloud)$/.test(model.id)) return "ollama";
  return undefined;
}
function percent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new UsageError("Quota percentage unavailable or invalid.");
  return value;
}
export function parseChatGPTWindows(data: any, now = Date.now()): Quota[] {
  const windows = [data?.rate_limit?.primary_window, data?.rate_limit?.secondary_window];
  const quotas: Quota[] = [];
  for (const [duration, period] of [[18000, "5h"], [604800, "weekly"]] as const) {
    const window = windows.find(w => w?.limit_window_seconds === duration);
    if (!window) continue;
    // Invalid data in one window must not hide the other valid allowance.
    try {
      const reset = window.reset_at;
      quotas.push({ provider: "chatgpt", period, percent: percent(window.used_percent), observedAt: now,
        ...(typeof reset === "number" && Number.isFinite(reset) && reset > 0 && reset < 8640000000000
          ? { resetAt: reset * 1000 } : {}) });
    } catch (e) { if (!(e instanceof UsageError)) throw e; }
  }
  if (!quotas.length) throw new UsageError("No valid 5h or weekly Codex quota returned for this account.");
  return quotas;
}
export function parseChatGPT(data: any, now = Date.now()): Quota {
  const windows = [data?.rate_limit?.primary_window, data?.rate_limit?.secondary_window];
  const weekly = windows.find(w => w?.limit_window_seconds === 604800);
  if (!weekly) throw new UsageError("No weekly Codex quota returned for this account.");
  const reset = weekly.reset_at;
  return {
    provider: "chatgpt", period: "weekly", percent: percent(weekly.used_percent), observedAt: now,
    ...(typeof reset === "number" && Number.isFinite(reset) && reset > 0 && reset < 8640000000000
      ? { resetAt: reset * 1000 } : {}),
  };
}
export function parseOllama(html: string, now = Date.now()): Quota {
  // Read only the monthly block. Never mistake top-up credits or a model price for quota.
  const start = html.indexOf("Monthly usage");
  if (start < 0) throw new UsageError("Monthly usage missing; check the Ollama website session.");
  const block = html.slice(start, start + 16000).split(/Models used this month|Weekly usage|Extra usage|Session usage/)[0];
  const text = block.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const amounts = text.match(/\$([\d,]+(?:\.\d+)?)\s+of\s+\$([\d,]+(?:\.\d+)?)\s+used/i);
  if (!amounts) throw new UsageError("Ollama monthly-credit layout not recognized.");
  const used = Number(amounts[1].replaceAll(",", ""));
  const limit = Number(amounts[2].replaceAll(",", ""));
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0)
    throw new UsageError("Ollama monthly allowance is missing or zero.");
  const rawReset = block.match(/data-time=["']([^"']+)["']/)?.[1];
  const reset = rawReset && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(rawReset) ? Date.parse(rawReset) : NaN;
  return { provider: "ollama", period: "monthly", percent: percent(used / limit * 100), used, limit,
    observedAt: now, ...(Number.isFinite(reset) ? { resetAt: reset } : {}) };
}
export type Color = "dim" | "accent" | "warning" | "error";
export function colorFor(p: number, period: Quota["period"] = "weekly"): Color {
  const [watch, caution, critical] = period === "5h" ? [80, 90, 100] : [70, 85, 95];
  return p >= critical ? "error" : p >= caution ? "warning" : p >= watch ? "accent" : "dim";
}
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function readout(q: Quota, fg: (color: Color, text: string) => string, stale: boolean, now: number): string {
  const remaining = q.resetAt === undefined ? undefined : q.resetAt - now;
  const countdown = remaining === undefined ? "" : q.period === "5h"
    ? remaining <= 3_600_000 ? `${Math.ceil(remaining / 60_000)}m` : `${Math.ceil(remaining / 3_600_000)}h`
    : `${Math.ceil(remaining / 86_400_000)}d`;
  return fg("dim", stale ? "~" : "") + fg(colorFor(q.percent, q.period), `${String(Math.round(q.percent)).padStart(2, "0")}%`) +
    (countdown ? fg("dim", ` ↻${countdown}`) : "");
}
export function footer(q: Quota | undefined, fg: (color: Color, text: string) => string, stale = false, now = Date.now()): string {
  if (!q || (q.resetAt !== undefined && q.resetAt <= now)) return fg("dim", "?");
  return fg("dim", q.provider === "ollama" ? "🦙 " : "CG ") + readout(q, fg, stale, now);
}
export type ProviderState = { quota?: Quota; quotas?: Quota[]; error?: string; loading?: boolean };
export function statusSummary(states: Record<Provider, ProviderState>, fg: (color: Color, text: string) => string, now = Date.now(), providers: readonly Provider[] = ["chatgpt", "ollama"]): string {
  const parts = providers.map(provider => {
    const { quota: q, quotas, error, loading } = states[provider];
    const label = provider === "chatgpt" ? "GPT" : "OLM";
    let value: string;
    if (q || quotas?.length) {
      const windows = quotas ?? (q ? [q] : []);
      const render = (window?: Quota) => !window ? fg("dim", "unavailable")
        : window.resetAt !== undefined && window.resetAt <= now ? fg("dim", "expired")
        : readout(window, fg, now - window.observedAt > 30 * 60_000, now);
      value = provider === "chatgpt"
        ? (["5h", "weekly"] as const).map(period => render(windows.find(w => w.period === period))).join(fg("dim", " · "))
        : render(windows[0]);
    } else {
      value = fg("dim", loading ? "loading" : error ? "unavailable" : q ? "expired" : "pending");
    }
    return fg("dim", `${label}: `) + value;
  });
  return parts.join(fg("dim", " | "));
}
export function details(q: Quota): string {
  return [q.provider === "chatgpt" ? `ChatGPT / Codex ${q.period === "5h" ? "5-hour" : "weekly"} quota (not general ChatGPT chat limits)` : "Ollama monthly subscription quota",
    `${q.percent.toFixed(1)}% used; ${Math.max(0, 100 - q.percent).toFixed(1)}% remaining`,
    ...(q.used !== undefined && q.limit !== undefined ? [`$${q.used.toFixed(2)} of $${q.limit.toFixed(2)} used`] : []),
    q.resetAt ? `Reset: ${new Date(q.resetAt).toLocaleString()}` : "Reset: unavailable",
    `Checked: ${new Date(q.observedAt).toLocaleString()}`].join("\n");
}
