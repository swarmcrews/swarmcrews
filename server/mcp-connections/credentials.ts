import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { mcpServersFilePath, listMcpServers } from "../mcp-server-store.ts";
import type { McpServerEntry } from "../../shared/mcp-servers/types.ts";
import { SECRET_MASK } from "../../shared/mcp-servers/connections.ts";

export interface Credentials { revision: string; redirectUrl: string; client?: OAuthClientInformationMixed; tokens?: OAuthTokens }
const epochs = new Map<string, number>();
export const credentialEpoch = (project: string, id: string): number => epochs.get(JSON.stringify([project, id])) ?? 0;
export function connectionRevision(entry: McpServerEntry): string {
  // Credential scope excludes display and enabled state; changing an endpoint
  // or authentication settings never reuses the previous server's tokens.
  return createHash("sha256").update(JSON.stringify(entry.transport === "stdio" ? entry : { transport: entry.transport, url: entry.url, oauth: entry.oauth, headers: entry.headers })).digest("hex");
}
function credentialPath(project: string, id: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error("Invalid connection ID");
  return path.join(path.dirname(mcpServersFilePath(project)), "mcp-credentials", `${id}.json`);
}
export function readCredentials(project: string, entry: McpServerEntry): Credentials | undefined {
  const file = credentialPath(project, entry.id);
  if (!fs.existsSync(file)) return undefined;
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as Credentials;
  return data.revision === connectionRevision(entry) ? data : undefined;
}
export function saveCredentials(project: string, id: string, data: Credentials, expectedEpoch?: number): void {
  if (expectedEpoch !== undefined) {
    const current = listMcpServers(project).entries.find(entry => entry.id === id);
    if (credentialEpoch(project, id) !== expectedEpoch || !current || connectionRevision(current) !== data.revision) throw new Error("Connection changed. Start sign-in again.");
  }
  const file = credentialPath(project, id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
export function deleteCredentials(project: string, id: string): void {
  epochs.set(JSON.stringify([project, id]), credentialEpoch(project, id) + 1);
  fs.rmSync(credentialPath(project, id), { force: true });
}
export function redactEntry(entry: McpServerEntry): McpServerEntry {
  const masked = (map: Record<string, string>) => Object.fromEntries(Object.keys(map).map(key => [key, SECRET_MASK]));
  if (entry.transport === "stdio") return { ...entry, ...(entry.env ? { env: masked(entry.env) } : {}) };
  return { ...entry, ...(entry.headers ? { headers: masked(entry.headers) } : {}),
    ...(entry.oauth ? { oauth: { ...entry.oauth, ...(entry.oauth.clientSecret ? { clientSecret: SECRET_MASK } : {}) } } : {}) };
}
export function restoreSecrets(entry: McpServerEntry, previous?: McpServerEntry): McpServerEntry {
  const restore = (values: Record<string, string> | undefined, old: Record<string, string> | undefined) =>
    values && Object.fromEntries(Object.entries(values).map(([key, value]) => {
      if (value !== SECRET_MASK) return [key, value];
      if (old?.[key] === undefined) throw new Error(`Enter a value for ${key}`);
      return [key, old[key]];
    }));
  if (entry.transport === "stdio") return { ...entry, ...(entry.env ? { env: restore(entry.env, previous?.transport === "stdio" ? previous.env : undefined) } : {}) };
  const old = previous?.transport !== "stdio" ? previous : undefined;
  const secret = entry.oauth?.clientSecret;
  if (secret === SECRET_MASK && !old?.oauth?.clientSecret) throw new Error("Enter the OAuth client secret");
  return { ...entry, ...(entry.headers ? { headers: restore(entry.headers, old?.headers) } : {}),
    ...(entry.oauth ? { oauth: { ...entry.oauth, ...(secret === SECRET_MASK ? { clientSecret: old!.oauth!.clientSecret } : {}) } } : {}) };
}
