import type { Router, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { parseMcpServerEntry } from "../../shared/mcp-servers/types.ts";
import { listMcpServers, deleteMcpServer } from "../mcp-server-store.ts";
import { param, resolveProjectReference } from "../routes/projects/helpers.ts";
import { isAllowedOrigin } from "../network-access.ts";
import { closeConnectionScope, connectionStatus, inspectConnection, invalidateConnection, recordConnectionFailure, requireConnection } from "./runtime.ts";
import { redactEntry, deleteCredentials } from "./credentials.ts";
import { saveConnectionConfiguration } from "./configuration.ts";
import { beginAuthorization, cancelAuthorization, completeAuthorization } from "./oauth.ts";

export function mountConnectionRoutes(router: Router): void {
  const base = "/:encodedPath/mcp-servers";
  router.get(base, (req, res) => {
    const project = resolveProjectReference(param(req, "encodedPath"));
    if (!project) { res.status(403).json({ error: "Project not registered" }); return; }
    try { const result = listMcpServers(project);
      res.setHeader("Cache-Control", "no-store");
      res.json({ ...result, entries: result.entries.map(redactEntry), statuses: Object.fromEntries(result.entries.map(entry => [entry.id, connectionStatus(project, entry)])) });
    } catch { res.status(500).json({ error: "Could not read saved connections. Check workspace storage and retry." }); }
  });
  router.put(`${base}/:serverId`, async (req, res) => {
    const project = resolveProjectReference(param(req, "encodedPath"));
    if (!project) { res.status(403).json({ error: "Project not registered" }); return; }
    try {
      const draft = parseMcpServerEntry(req.body);
      if (draft.id !== param(req, "serverId")) { res.status(400).json({ error: "Connection ID does not match the URL" }); return; }
      res.json(await saveConnectionConfiguration(project, draft));
    } catch { res.status(400).json({ error: "Could not save. Check the name, ID, command or HTTPS URL, and credential fields." }); }
  });
  router.delete(`${base}/:serverId`, async (req, res) => {
    const project = resolveProjectReference(param(req, "encodedPath"));
    if (!project) { res.status(403).json({ error: "Project not registered" }); return; }
    const id = param(req, "serverId");
    try {
      const removed = deleteMcpServer(project, id);
      cancelAuthorization(project, id); deleteCredentials(project, id); await invalidateConnection(project, id);
      res.status(removed ? 200 : 404).json(removed ? { ok: true } : { error: "Connection not found" });
    } catch { res.status(500).json({ error: "Could not remove connection. Check workspace storage and retry." }); }
  });
  router.post(`${base}/:serverId/test`, async (req, res) => {
    const project = resolveProjectReference(param(req, "encodedPath"));
    if (!project) { res.status(403).json({ error: "Project not registered" }); return; }
    const id = param(req, "serverId"); const scope = `probe:${randomUUID()}`;
    try { const inventory = await inspectConnection(project, id, scope);
      res.json({ status: connectionStatus(project, requireConnection(project, id)), inventory });
    } catch (error) { res.json({ status: recordConnectionFailure(project, id, error) }); }
    finally { await closeConnectionScope(scope); }
  });
  router.post(`${base}/:serverId/authorize`, async (req, res) => {
    const project = resolveProjectReference(param(req, "encodedPath"));
    if (!project) { res.status(403).json({ error: "Project not registered" }); return; }
    const id = param(req, "serverId");
    const origin = req.get("origin");
    if (!origin || !isAllowedOrigin(origin)) { res.status(400).json({ error: "Start sign-in from the Swarmcrews browser window." }); return; }
    try { res.json(await beginAuthorization(project, requireConnection(project, id), `${new URL(origin).origin}/api/mcp/oauth/callback`)); }
    catch (error) { res.status(400).json({ error: recordConnectionFailure(project, id, error).message }); }
  });
  router.post(`${base}/:serverId/disconnect`, async (req, res) => {
    const project = resolveProjectReference(param(req, "encodedPath"));
    if (!project) { res.status(403).json({ error: "Project not registered" }); return; }
    const id = param(req, "serverId");
    try { cancelAuthorization(project, id); deleteCredentials(project, id); await invalidateConnection(project, id); res.json({ ok: true }); }
    catch { res.status(400).json({ error: "Could not clear sign-in. Retry from Connections." }); }
  });
}
/** OAuth state is a short-lived, one-use capability bound to a server and project. */
export const connectionOAuthCallback: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const result = await completeAuthorization(typeof req.query.state === "string" ? req.query.state : "", typeof req.query.code === "string" ? req.query.code : "");
    await invalidateConnection(result.project, result.id);
    res.type("html").send("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Connected · Swarmcrews</title><body><main><h1>You're signed in</h1><p>Return to Swarmcrews Connections and select Test connection. You can close this tab.</p></main></body></html>");
  } catch { res.status(400).type("html").send("<!doctype html><html lang='en'><meta charset='utf-8'><title>Sign-in · Swarmcrews</title><body><h1>Sign-in wasn't completed</h1><p>Return to Connections and select Sign in to try again.</p></body></html>"); }
};
