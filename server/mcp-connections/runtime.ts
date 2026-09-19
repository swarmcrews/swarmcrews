import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerEntry } from "../../shared/mcp-servers/types.ts";
import type { ConnectionInventory, ConnectionStatus } from "../../shared/mcp-servers/connections.ts";
import { listMcpServers } from "../mcp-server-store.ts";
import { credentialProvider, connectionFetch } from "./oauth.ts";

interface LiveConnection { project: string; id: string; scope: string; revision: string; client: Client; transport: Transport; ready: Promise<Client> }
const connections = new Map<string, LiveConnection>();
const statuses = new Map<string, ConnectionStatus>();
export class ConnectionInputError extends Error {}
const keyFor = (project: string, id: string) => JSON.stringify([project, id]);
function setStatus(project: string, id: string, status: ConnectionStatus): void {
  const key = keyFor(project, id);
  statuses.delete(key); statuses.set(key, status);
  if (statuses.size > 1000) statuses.delete(statuses.keys().next().value!);
}
export function requireConnection(project: string, id: string): McpServerEntry {
  const entry = listMcpServers(project).entries.find(item => item.id === id);
  if (!entry) throw new ConnectionInputError("Connection not found. Add it in Connections first.");
  if (entry.enabled === false) throw new ConnectionInputError("Connection is disabled. Enable it in Connections first.");
  return entry;
}
export function connectionStatus(project: string, entry: McpServerEntry): ConnectionStatus {
  return entry.enabled === false ? { state: "disabled" } : statuses.get(keyFor(project, entry.id)) ?? { state: "untested" };
}
export function connectionError(error: unknown): string {
  if (error instanceof ConnectionInputError) return error.message;
  if ((error as { code?: string })?.code === "MCP_REDIRECT") return "The server redirected to another address. Enter its final MCP URL and test again.";
  if (error instanceof UnauthorizedError || (error as { code?: number })?.code === 401) return "Sign in or update your credentials, then test the connection again.";
  if ((error as { code?: string })?.code === "ENOENT") return "Command not found on the Swarmcrews host. Check the command and install its runtime.";
  if (error instanceof Error && /timeout|timed out|aborted/i.test(error.message)) return "The server did not respond in time. Check its address or command and retry.";
  return "Could not complete the MCP request. Check the server, credentials and configuration, then retry.";
}
export function recordConnectionFailure(project: string, id: string, error: unknown): ConnectionStatus {
  const status: ConnectionStatus = { state: error instanceof UnauthorizedError || (error as { code?: number })?.code === 401 ? "auth_required" : "error",
    message: connectionError(error), checkedAt: Date.now() };
  setStatus(project, id, status); return status;
}
function createTransport(project: string, entry: McpServerEntry): Transport {
  if (entry.transport === "stdio") {
    const transport = new StdioClientTransport({ command: entry.command, args: entry.args, cwd: project,
      env: { ...getDefaultEnvironment(), ...entry.env }, stderr: "pipe" });
    // Drain without forwarding secret-bearing stderr into app logs.
    transport.stderr?.on("data", () => {});
    return transport;
  }
  const options = { requestInit: { headers: entry.headers }, authProvider: credentialProvider(project, entry), fetch: connectionFetch };
  return entry.transport === "sse" ? new SSEClientTransport(new URL(entry.url), options)
    : new StreamableHTTPClientTransport(new URL(entry.url), options);
}
async function getClient(project: string, id: string, scope: string): Promise<Client> {
  const entry = requireConnection(project, id);
  const key = JSON.stringify([project, id, scope]);
  const revision = JSON.stringify(entry);
  const existing = connections.get(key);
  if (existing?.revision === revision) return existing.ready;
  if (existing) { connections.delete(key); await closeLive(existing); }
  if (connections.size >= 128) throw new Error("Connection limit reached. Close an unused session and retry.");
  const client = new Client({ name: "swarmcrews", version: "0.1.0" });
  const transport = createTransport(project, entry);
  setStatus(project, id, { state: "connecting" });
  const live: LiveConnection = { project, id, scope, revision, client, transport, ready: Promise.resolve(client) };
  connections.set(key, live);
  live.ready = client.connect(transport, { timeout: 15_000 }).then(() => {
    if (connections.get(key) !== live) throw new Error("Connection was changed or closed.");
    setStatus(project, id, { state: "ready", checkedAt: Date.now() });
    client.onclose = () => { if (connections.get(key) === live) { connections.delete(key); setStatus(project, id, { state: "untested", message: "Disconnected. Test or use the connection to reconnect." }); } };
    return client;
  }).catch(async error => {
    if (connections.get(key) === live) { connections.delete(key); recordConnectionFailure(project, id, error); }
    await client.close().catch(() => {}); throw error;
  });
  return live.ready;
}
async function closeLive(live: LiveConnection): Promise<void> {
  try {
    if (live.transport instanceof StreamableHTTPClientTransport) await live.transport.terminateSession();
  } catch { /* Best effort: servers may already have closed their sessions. */ }
  finally { await live.client.close(); }
}
export async function closeConnectionScope(scope: string): Promise<void> {
  const closing = [...connections.entries()].filter(([, value]) => value.scope === scope);
  for (const [key] of closing) connections.delete(key);
  await Promise.allSettled(closing.map(([, value]) => closeLive(value)));
}
export async function invalidateConnection(project: string, id: string): Promise<void> {
  const closing = [...connections.entries()].filter(([, value]) => value.project === project && value.id === id);
  for (const [key] of closing) connections.delete(key);
  statuses.delete(keyFor(project, id));
  await Promise.allSettled(closing.map(([, value]) => closeLive(value)));
}
/** Catalog pagination is bounded; silent truncation would hide tools. */
async function pages<T>(read: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>): Promise<T[]> {
  const items: T[] = []; let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const result = await read(cursor); items.push(...result.items);
    if (items.length > 5000) break;
    if (!result.nextCursor) return items;
    if (result.nextCursor === cursor || items.length > 5000) break;
    cursor = result.nextCursor;
  }
  throw new Error("Server capability catalog exceeds supported limits.");
}
export async function inspectConnection(project: string, id: string, scope: string): Promise<ConnectionInventory> {
  const client = await getClient(project, id, scope);
  const deadline = AbortSignal.timeout(30_000);
  const capabilities = client.getServerCapabilities();
  const entry = requireConnection(project, id);
  const tools = capabilities?.tools ? await pages(async cursor => { const r = await client.listTools({ cursor }, { timeout: 15_000, signal: deadline }); return { items: r.tools, nextCursor: r.nextCursor }; }) : [];
  const resources = capabilities?.resources ? await pages(async cursor => { const r = await client.listResources({ cursor }, { timeout: 15_000, signal: deadline }); return { items: r.resources, nextCursor: r.nextCursor }; }) : [];
  const prompts = capabilities?.prompts ? await pages(async cursor => { const r = await client.listPrompts({ cursor }, { timeout: 15_000, signal: deadline }); return { items: r.prompts, nextCursor: r.nextCursor }; }) : [];
  const allowed = tools.filter(tool => !entry.allowedTools || entry.allowedTools.includes(tool.name));
  setStatus(project, id, { state: "ready", checkedAt: Date.now(), toolCount: allowed.length });
  return { tools: allowed, resources, prompts };
}
export async function invokeConnection(project: string, id: string, scope: string,
  operation: "tool" | "resource" | "prompt", name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const entry = requireConnection(project, id);
  if (operation === "tool" && entry.allowedTools && !entry.allowedTools.includes(name)) throw new ConnectionInputError("This tool is not enabled for the connection.");
  const client = await getClient(project, id, scope);
  const options = { timeout: 60_000, ...(signal ? { signal } : {}) };
  if (operation === "tool") return client.callTool({ name, arguments: args }, undefined, options);
  if (operation === "resource") return client.readResource({ uri: name }, options);
  if (!Object.values(args).every(value => typeof value === "string")) throw new ConnectionInputError("Prompt arguments must be strings.");
  return client.getPrompt({ name, arguments: args as Record<string, string> }, options);
}
