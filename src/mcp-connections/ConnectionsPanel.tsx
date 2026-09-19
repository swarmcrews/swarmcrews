import { useCallback, useEffect, useRef, useState } from "react";
import { Plug, Plus, RefreshCw, ArrowUpRight, CheckCircle2, AlertCircle } from "lucide-react";
import { listProjectMcpServers, saveProjectMcpServer, deleteProjectMcpServer, testProjectConnection, authorizeProjectConnection, disconnectProjectConnection } from "../api.ts";
import type { McpServerEntry } from "../../shared/mcp-servers/types.ts";
import type { ConnectionInventory, ConnectionState, ConnectionStatus } from "../../shared/mcp-servers/connections.ts";
import { ConnectionForm } from "./ConnectionForm.tsx";
import "./connections.css";

const labels: Record<ConnectionState, string> = { untested: "Not tested", connecting: "Connecting", ready: "Verified", auth_required: "Sign-in required", error: "Needs attention", disabled: "Disabled" };
export function ConnectionsPanel({ projectId, onCount }: { projectId: string; onCount?: (count: number) => void }) {
  const [entries, setEntries] = useState<McpServerEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({});
  const [inventories, setInventories] = useState<Record<string, ConnectionInventory>>({});
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<McpServerEntry | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const generation = useRef(0); const current = useRef(true);
  useEffect(() => { current.current = true; return () => { current.current = false; generation.current++; }; }, []);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await listProjectMcpServers(projectId);
      if (!current.current || request !== generation.current) return;
      setEntries(result.entries); setStatuses(result.statuses ?? {}); onCount?.(result.entries.length);
      setError(result.invalid.length ? `${result.invalid.length} saved connection(s) could not be read. Repair the workspace configuration before adding more.` : "");
    } catch (err) { if (current.current && request === generation.current) setError(err instanceof Error ? err.message : "Couldn't load connections. Retry below."); }
    finally { if (current.current && request === generation.current) setLoading(false); }
  }, [projectId, onCount]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const focus = () => { void load(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [load]);
  async function test(id: string) {
    setBusy(id); setError(""); setStatuses(prev => ({ ...prev, [id]: { state: "connecting" } }));
    setInventories(prev => { const next = { ...prev }; delete next[id]; return next; });
    try { const result = await testProjectConnection(projectId, id);
      if (current.current) { setStatuses(prev => ({ ...prev, [id]: result.status })); if (result.inventory) setInventories(prev => ({ ...prev, [id]: result.inventory! })); }
    } catch (err) { if (current.current) { setError(err instanceof Error ? err.message : "Test failed. Retry."); setStatuses(prev => ({ ...prev, [id]: { state: "error" } })); } }
    finally { if (current.current) setBusy(null); }
  }
  async function save(entry: McpServerEntry) {
    setBusy(entry.id);
    try { await saveProjectMcpServer(projectId, entry); if (!current.current) return;
      setEditing(null); await load();
      window.dispatchEvent(new CustomEvent("project-connections-changed", { detail: { projectId } }));
      setNotice("Connection saved. Review Execution sandbox → Approval before using MCP. Never ask can block tools that require permission; On request lets the harness ask. Connection access is separate from file access.");
      if (entry.enabled !== false) await test(entry.id);
    } finally { if (current.current) setBusy(null); }
  }
  async function action(entry: McpServerEntry, type: "toggle" | "delete" | "disconnect" | "authorize") {
    setError(""); setNotice(""); setBusy(entry.id);
    // Open synchronously to avoid popup blocking after the auth request.
    const popup = type === "authorize" ? window.open("about:blank", "swarmcrews-mcp-sign-in") : null;
    try {
      if (type === "authorize") {
        const result = await authorizeProjectConnection(projectId, entry.id);
        if (result.authorizationUrl) {
          if (popup) { popup.opener = null; popup.location.href = result.authorizationUrl; }
          else { setNotice("Allow popups for Swarmcrews, then select Sign in again."); return; }
          setNotice("Complete sign-in in the new tab, then select Test connection here.");
        } else { popup?.close(); await test(entry.id); }
      } else {
        if (type === "toggle") await saveProjectMcpServer(projectId, { ...entry, enabled: entry.enabled === false });
        if (type === "delete") { await deleteProjectMcpServer(projectId, entry.id); setConfirmDelete(null); }
        if (type === "disconnect") { await disconnectProjectConnection(projectId, entry.id); setNotice("Saved OAuth sign-in cleared. Disable the connection to prevent further use."); }
        setInventories(prev => { const next = { ...prev }; delete next[entry.id]; return next; });
        await load();
        window.dispatchEvent(new CustomEvent("project-connections-changed", { detail: { projectId } }));
      }
    } catch (err) { popup?.close(); setError(err instanceof Error ? err.message : "Couldn't update connection. Retry."); }
    finally { if (current.current) setBusy(null); }
  }
  return <section className="connections" aria-label="Connections">
    <header className="connections-heading"><div className="connections-eyebrow"><Plug size={15} aria-hidden="true" /> PROJECT CONNECTIONS</div>
      <div className="connections-title"><h2>Your tools, in every agent</h2><button type="button" aria-label="Refresh connections" disabled={Boolean(busy)} onClick={() => { void load(); }}><RefreshCw size={16} /></button></div>
      <p>Connect apps and local tools once. Swarmcrews makes them available across harnesses.</p>
    </header>
    {error && <div className="connection-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => { void load(); }}>Retry</button></div>}
    {notice && <p className="connection-notice" role="status">{notice}</p>}
    {editing ? <ConnectionForm key={editing === "new" ? "new" : editing.id} entry={editing === "new" ? undefined : editing} existingIds={entries.map(e => e.id)} busy={Boolean(busy)} onSave={save} onCancel={() => setEditing(null)} /> : <>
      <div className="connections-toolbar"><span>{entries.length} {entries.length === 1 ? "connection" : "connections"}</span><button type="button" className="connection-primary" onClick={() => setEditing("new")}><Plus size={15} aria-hidden="true" />Add connection</button></div>
      {loading ? <p role="status" className="connection-empty">Loading connections…</p> : entries.length === 0 && !error ? <div className="connection-empty"><Plug size={32} aria-hidden="true" /><h3>Bring your tools into the conversation</h3><p>Add an MCP server for documentation, project data, or a local workflow. Start with a URL or an install command.</p><button type="button" onClick={() => setEditing("new")}>Add your first connection <ArrowUpRight size={15} /></button></div> : null}
      <div className="connection-list">{entries.map(entry => {
        const status = entry.enabled === false ? { state: "disabled" as const } : statuses[entry.id] ?? { state: "untested" as const };
        const inventory = inventories[entry.id];
        return <article className="connection-card" key={entry.id} aria-label={entry.name}>
          <div className="connection-card-title"><span className="connection-symbol"><Plug size={18} aria-hidden="true" /></span><div><h3>{entry.name}{entry.isDefault === true && " · Default"}{entry.selfServe === false && " · Self-serve off"}</h3><span className="connection-muted">{entry.transport === "stdio" ? "Local · Swarmcrews host" : entry.transport === "sse" ? "Remote · Legacy SSE" : "Remote · Streamable HTTP"}</span></div><span className="connection-state" data-state={status.state}>{status.state === "ready" && <CheckCircle2 size={12} aria-hidden="true" />}{labels[status.state]}</span></div>
          <p className="connection-endpoint">{entry.transport === "stdio" ? entry.command : entry.url.replace(/[?#].*$/, "")}</p>
          {status.message && <p className="connection-notice" role="status">{status.message}</p>}
          {status.state === "ready" && <p className="connection-verified">{status.toolCount !== undefined || inventory ? `${status.toolCount ?? inventory?.tools.length} tools available · ` : ""}{status.checkedAt ? `Checked ${new Date(status.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Connection verified"}</p>}
          <div className="connection-actions">
            <button type="button" disabled={Boolean(busy) || entry.enabled === false} onClick={() => { void test(entry.id); }}>{busy === entry.id ? "Working…" : status.state === "error" ? "Retry connection" : "Test connection"}</button>
            {entry.transport !== "stdio" && status.state === "auth_required" && <button type="button" disabled={Boolean(busy) || entry.enabled === false} className="connection-primary" onClick={() => { void action(entry, "authorize"); }}>Sign in <ArrowUpRight size={13} /></button>}
            <button type="button" disabled={Boolean(busy)} onClick={() => { void action(entry, "toggle"); }}>{entry.enabled === false ? "Enable" : "Disable"}</button>
          </div>
          {inventory && entry.enabled !== false && <details className="connection-capabilities"><summary>Explore capabilities · {inventory.tools.length} tools</summary><ul>{inventory.tools.map(tool => <li key={tool.name}><strong>{tool.name}</strong><p>{tool.description}</p></li>)}</ul>{inventory.resources.length > 0 && <p>{inventory.resources.length} resources available</p>}{inventory.prompts.length > 0 && <p>{inventory.prompts.length} prompts available</p>}<p className="connection-notice">Try asking your agent: “Use {entry.name} to list the information available for this task.”</p></details>}
          <div className="connection-card-footer"><span>Project-wide · all harnesses</span><button type="button" disabled={Boolean(busy)} onClick={() => setEditing(entry)}>Edit</button><details><summary>More</summary><div className="connection-actions">{entry.transport !== "stdio" && <button type="button" disabled={Boolean(busy)} onClick={() => { void action(entry, "disconnect"); }}>Clear sign-in</button>}<button type="button" disabled={Boolean(busy)} onClick={() => setConfirmDelete(entry.id)}>Remove</button></div></details></div>
          {confirmDelete === entry.id && <div className="connection-notice" role="alert"><p>Remove {entry.name}? Agents will lose access and its saved sign-in will be cleared.</p><div className="connection-actions"><button type="button" disabled={Boolean(busy)} onClick={() => { void action(entry, "delete"); }}>Remove connection</button><button type="button" onClick={() => setConfirmDelete(null)}>Keep connection</button></div></div>}
        </article>;
      })}</div>
      {entries.length > 0 && <p className="connections-footnote">Verified means the last check succeeded. Agents connect when needed; no harness restart is required. External tools use the connection's access, independently of an agent's filesystem sandbox.</p>}
    </>}
  </section>;
}
