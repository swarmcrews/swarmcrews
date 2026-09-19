import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beginAuthorization, completeAuthorization, cancelAuthorization, credentialProvider } from "./oauth.ts";
import { readCredentials, deleteCredentials } from "./credentials.ts";
import { saveMcpServer } from "../mcp-server-store.ts";
import type { McpServerEntry } from "../../shared/mcp-servers/types.ts";
let project: string; let tokenRequests: URLSearchParams[];
const entry: McpServerEntry = { id: "oauth", name: "OAuth fixture", transport: "http", url: "https://mcp.example/mcp" };
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-oauth-")); tokenRequests = []; saveMcpServer(project, entry);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    if (url.includes("oauth-protected-resource")) return json({ resource: entry.url, authorization_servers: ["https://auth.example"] });
    if (url.includes("oauth-authorization-server")) return json({ issuer: "https://auth.example", authorization_endpoint: "https://auth.example/authorize", token_endpoint: "https://auth.example/token", registration_endpoint: "https://auth.example/register", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], grant_types_supported: ["authorization_code", "refresh_token"] });
    if (url.endsWith("/register")) return json({ client_id: "fixture-client", ...JSON.parse(String(init?.body)) });
    if (url.endsWith("/token")) { tokenRequests.push(new URLSearchParams(String(init?.body))); return json({ access_token: "fixture-access", token_type: "Bearer", refresh_token: "fixture-refresh", expires_in: 3600 }); }
    return new Response(null, { status: 404 });
  }));
});
afterEach(() => { cancelAuthorization(project, entry.id); fs.rmSync(project, { recursive: true, force: true }); vi.unstubAllGlobals(); });
describe("Swarmcrews OAuth", () => {
  it("discovers metadata, registers, binds state/PKCE, exchanges and persists credentials once", async () => {
    const result = await beginAuthorization(project, entry, "http://localhost:6473/api/mcp/oauth/callback");
    const url = new URL(result.authorizationUrl!);
    expect(url.origin).toBe("https://auth.example");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe(entry.url);
    const state = url.searchParams.get("state")!;
    await expect(completeAuthorization("wrong-state", "code")).rejects.toThrow("expired");
    expect(await completeAuthorization(state, "valid-code")).toEqual({ project, id: entry.id });
    expect(tokenRequests[0]!.get("code_verifier")).toBeTruthy();
    expect(tokenRequests[0]!.get("code")).toBe("valid-code");
    expect(readCredentials(project, entry)?.tokens?.access_token).toBe("fixture-access");
    await expect(completeAuthorization(state, "valid-code")).rejects.toThrow("expired");
  });
  it("cancellation rejects callbacks and revocation fences late token writes", async () => {
    const result = await beginAuthorization(project, entry, "http://localhost/callback");
    const state = new URL(result.authorizationUrl!).searchParams.get("state")!;
    cancelAuthorization(project, entry.id);
    await expect(completeAuthorization(state, "code")).rejects.toThrow("cancelled");
    const provider = credentialProvider(project, entry, "http://localhost/callback")!;
    deleteCredentials(project, entry.id);
    expect(() => provider.saveTokens({ access_token: "late", token_type: "Bearer" })).toThrow("changed");
    expect(readCredentials(project, entry)).toBeUndefined();
  });
});


it("never follows redirects that would forward credentials to another origin", async () => {
  const { connectionFetch } = await import("./oauth.ts");
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 307, headers: { Location: "http://attacker.example/mcp" } }));
  vi.stubGlobal("fetch", fetch);
  await expect(connectionFetch("https://fixture.example/mcp", { method: "POST", headers: { Authorization: "Bearer secret" }, body: "request" })).rejects.toThrow("final MCP URL");
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
});
