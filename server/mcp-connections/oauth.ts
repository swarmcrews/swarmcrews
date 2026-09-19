import { randomUUID } from "node:crypto";
import { auth, UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpServerEntry } from "../../shared/mcp-servers/types.ts";
import { isSecureMcpUrl } from "../../shared/mcp-servers/types.ts";
import { connectionRevision, readCredentials, saveCredentials, credentialEpoch, type Credentials } from "./credentials.ts";

export const connectionFetch: typeof fetch = async (input, init) => {
  let url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const deadline = AbortSignal.timeout(init?.method === "DELETE" ? 5_000 : 65_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  for (let hop = 0; hop < 6; hop++) {
    if (!isSecureMcpUrl(url.href)) throw new Error("MCP authentication and connections require HTTPS (or local HTTP).");
    const response = await fetch(url, { ...init, signal, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    const next = location ? new URL(location, url) : undefined;
    // Never forward credentials or an OAuth token exchange to another origin.
    if (!next || next.origin !== url.origin || ((init?.method ?? "GET") === "POST" && ![307, 308].includes(response.status))) {
      throw Object.assign(new Error("Use the server's final MCP URL."), { code: "MCP_REDIRECT" });
    }
    url = next;
  }
  throw Object.assign(new Error("Too many redirects."), { code: "MCP_REDIRECT" });
};

interface PendingAuth { project: string; entry: McpServerEntry; provider: OAuthClientProvider; expiresAt: number; url?: string }
const pending = new Map<string, PendingAuth>();
export function cancelAuthorization(project: string, id: string): void {
  for (const [state, flow] of pending) if (flow.project === project && flow.entry.id === id) pending.delete(state);
}
export function credentialProvider(project: string, entry: McpServerEntry, redirectUrl?: string,
  onRedirect?: (url: URL) => void, state?: string): OAuthClientProvider | undefined {
  const stored = readCredentials(project, entry);
  if (!stored && !redirectUrl) return undefined;
  const data: Credentials = stored ?? { revision: connectionRevision(entry), redirectUrl: redirectUrl! };
  const epoch = credentialEpoch(project, entry.id);
  const save = () => saveCredentials(project, entry.id, data, epoch);
  if (redirectUrl) data.redirectUrl = redirectUrl;
  const config = entry.transport !== "stdio" ? entry.oauth : undefined;
  let verifier: string | undefined;
  return {
    redirectUrl: data.redirectUrl,
    clientMetadata: { client_name: "Swarmcrews", redirect_uris: [data.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: config?.clientSecret ? "client_secret_post" : "none",
      ...(config?.scope ? { scope: config.scope } : {}) },
    state: () => state ?? randomUUID(),
    clientInformation: () => config?.clientId ? { client_id: config.clientId, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}) } : data.client,
    saveClientInformation: client => { data.client = client; save(); },
    tokens: () => readCredentials(project, entry)?.tokens,
    saveTokens: tokens => { data.tokens = tokens; save(); },
    redirectToAuthorization: url => { if (!isSecureMcpUrl(url.href)) throw new Error("Authorization requires HTTPS."); if (!onRedirect) throw new UnauthorizedError("Sign in again in Connections."); onRedirect(url); },
    saveCodeVerifier: value => { verifier = value; },
    codeVerifier: () => { if (!verifier) throw new Error("Sign-in expired. Start again in Connections."); return verifier; },
    invalidateCredentials: scope => { if (scope === "all" || scope === "client") delete data.client;
      if (scope === "all" || scope === "tokens") delete data.tokens;
      save(); },
  };
}
export async function beginAuthorization(project: string, entry: McpServerEntry, redirectUrl: string): Promise<{ authorizationUrl?: string }> {
  if (entry.transport === "stdio") throw new Error("Local servers use environment credentials.");
  for (const [key, flow] of pending) if (flow.expiresAt < Date.now()) pending.delete(key);
  cancelAuthorization(project, entry.id);
  if (pending.size >= 100) throw new Error("Too many pending sign-ins. Try again shortly.");
  const state = randomUUID();
  const flow: PendingAuth = { project, entry, expiresAt: Date.now() + 600_000,
    provider: credentialProvider(project, entry, redirectUrl, url => { flow.url = url.href; }, state)! };
  pending.set(state, flow);
  try {
    const result = await auth(flow.provider, { serverUrl: entry.url, ...(entry.oauth?.scope ? { scope: entry.oauth.scope } : {}), fetchFn: connectionFetch });
    if (result === "AUTHORIZED") pending.delete(state);
    return { ...(flow.url ? { authorizationUrl: flow.url } : {}) };
  } catch (error) { pending.delete(state); throw error; }
}
export async function completeAuthorization(state: string, code: string): Promise<{ project: string; id: string }> {
  const flow = pending.get(state);
  pending.delete(state); // single use, including failed exchanges
  if (!flow || flow.expiresAt < Date.now() || !code || flow.entry.transport === "stdio") throw new Error("Sign-in expired or cancelled. Return to Connections and try again.");
  await auth(flow.provider, { serverUrl: flow.entry.url, authorizationCode: code, fetchFn: connectionFetch });
  return { project: flow.project, id: flow.entry.id };
}
