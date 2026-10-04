import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseChatGPTWindows, parseOllama, UsageError, type Provider, type Quota } from "./quota.ts";

export const URLS = {
  chatgpt: "https://chatgpt.com/backend-api/wham/usage",
  ollama: "https://ollama.com/settings",
} as const;
export type Auth = { auth: { apiKey?: string; headers?: Record<string, string | null | undefined> }; source?: string };
export type SourceContext = { modelRegistry: { getProviderAuth(provider: string): Promise<Auth | undefined> } };

export async function readCookie(path: string): Promise<string> {
  const f = await open(path, "r");
  try {
    const s = await f.stat();
    if (!s.isFile() || (s.mode & 0o077) !== 0 || s.size > 16384 || (process.getuid && s.uid !== process.getuid()))
      throw new UsageError("Ollama cookie file must be owner-only (chmod 600), owned by you, and under 16KB.");
    const cookie = (await f.readFile("utf8")).trim();
    if (!cookie || /[\r\n\x00-\x1f\x7f]/.test(cookie) || !cookie.includes("="))
      throw new UsageError("Ollama cookie file must contain a single Cookie header value, without the Cookie: prefix.");
    if (/^cookie:/i.test(cookie)) throw new UsageError("Remove the Cookie: prefix from the cookie file.");
    return cookie;
  } finally { await f.close(); }
}
export async function boundedText(response: Response, limit = 1024 * 1024): Promise<string> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new UsageError(response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)
      ? "Usage authentication unavailable or expired; sign in again."
      : `Usage endpoint returned HTTP ${response.status}.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new UsageError("Empty usage response.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new UsageError("Usage response exceeded the size limit.");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function accountFromJWT(token: string): string | undefined {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    const id = p["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof id === "string" && /^[\w-]{1,128}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}
export async function loadQuota(provider: Provider, ctx: SourceContext, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<{ quota: Quota; quotas: Quota[]; identity: string }> {
  const headers: Record<string, string> = { Accept: provider === "chatgpt" ? "application/json" : "text/html" };
  let identity: string;
  let modernChatGPT = false;
  if (provider === "chatgpt") {
    // Current Pi's ChatGPT login belongs to openai, which also supports API keys.
    // Only OAuth is subscription auth; never forward an OpenAI API key here.
    const modern = await ctx.modelRegistry.getProviderAuth("openai");
    signal.throwIfAborted();
    modernChatGPT = modern?.source === "OAuth";
    const result = modernChatGPT ? modern
      : await ctx.modelRegistry.getProviderAuth("openai-codex");
    signal.throwIfAborted();
    const token = result?.auth.apiKey;
    if (!token) throw new UsageError("Sign into ChatGPT with Pi /login openai (Sign in with ChatGPT), or use the legacy OpenAI Codex login.");
    headers.Authorization = `Bearer ${token}`;
    const account = Object.entries(result?.auth.headers ?? {}).find(([k]) => k.toLowerCase() === "chatgpt-account-id")?.[1]
      ?? accountFromJWT(token);
    if (account) headers["ChatGPT-Account-Id"] = account;
    identity = account ?? token;
  } else {
    const path = process.env.PI_USAGE_OLLAMA_COOKIE_FILE || join(homedir(), ".config", "pi-usage", "ollama.cookie");
    try {
      headers.Cookie = await readCookie(path);
    } catch (e) {
      if (e instanceof UsageError) throw e;
      throw new UsageError("Ollama website cookie file unavailable. Use ~/.config/pi-usage/ollama.cookie or PI_USAGE_OLLAMA_COOKIE_FILE (owner-only, chmod 600). Local ollama signin is not website authentication.");
    }
    identity = headers.Cookie;
  }
  signal.throwIfAborted();
  // Fixed origins only; never forward credentials through redirects or configurable URLs.
  const response = await fetcher(URLS[provider], { headers, signal, redirect: "manual" });
  if (modernChatGPT && (response.status === 401 || response.status === 403)) {
    await response.body?.cancel();
    throw new UsageError("ChatGPT quota endpoint rejected Pi's new OpenAI OAuth token. This may be a token-scope incompatibility, not an expired login. Check https://chatgpt.com/settings/usage; new-login quota tracking is not yet verified.");
  }
  const text = await boundedText(response);
  let quotas: Quota[];
  if (provider === "chatgpt") {
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new UsageError("ChatGPT quota response was not JSON."); }
    quotas = parseChatGPTWindows(data);
  } else quotas = [parseOllama(text)];
  const quota = quotas.find(q => q.period === "weekly") ?? quotas[0];
  return { quota, quotas, identity: createHash("sha256").update(provider + identity).digest("hex") };
}
