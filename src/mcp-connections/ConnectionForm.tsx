import { ArgumentFields, CredentialFields } from "./ConnectionFields.tsx";
import { useState } from "react";
import type { McpServerEntry } from "../../shared/mcp-servers/types.ts";
import { parsePastedMcpConfig, sanitizeId, splitArgsLine } from "../mcp-paste-parser.ts";

function readMap(raw: string): Record<string, string> {
  const value: unknown = JSON.parse(raw || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(v => typeof v !== "string")) throw new Error("Credentials must be a JSON object with string values.");
  return value as Record<string, string>;
}
export function ConnectionForm({ entry, existingIds, busy, onSave, onCancel }: {
  entry?: McpServerEntry | undefined; existingIds: string[]; busy: boolean;
  onSave: (entry: McpServerEntry) => Promise<void>; onCancel: () => void;
}) {
  const [transport, setTransport] = useState<McpServerEntry["transport"]>(entry?.transport ?? "http");
  const [name, setName] = useState(entry?.name ?? "");
  const [id, setId] = useState(entry?.id ?? "");
  const [url, setUrl] = useState(entry && entry.transport !== "stdio" ? entry.url : "");
  const [command, setCommand] = useState(entry?.transport === "stdio" ? entry.command : "");
  const [args, setArgs] = useState(JSON.stringify(entry?.transport === "stdio" ? entry.args ?? [] : []));
  const [credentials, setCredentials] = useState(JSON.stringify(entry?.transport === "stdio" ? entry.env ?? {} : entry?.headers ?? {}, null, 2));
  const [oauth, setOauth] = useState(entry && entry.transport !== "stdio" ? entry.oauth ?? {} : {});
  const [isDefault, setIsDefault] = useState(entry?.isDefault === true);
  const [selfServe, setSelfServe] = useState(entry?.selfServe !== false);
  const [allowed, setAllowed] = useState(entry?.allowedTools?.join(", ") ?? "");
  const [paste, setPaste] = useState(""); const [advanced, setAdvanced] = useState(Boolean(entry));
  const [error, setError] = useState(""); const [warnings, setWarnings] = useState<string[]>([]);
  function importPaste() {
    const parsed = parsePastedMcpConfig(paste);
    if (!parsed.ok) { setError(parsed.error); return; }
    const d = parsed.draft; setTransport(d.transport); setName(d.name ?? ""); setId(d.id ?? "");
    setUrl(d.url ?? ""); setCommand(d.command ?? ""); setArgs(JSON.stringify(splitArgsLine(d.args ?? "")));
    const map: Record<string, string> = {};
    for (const line of (d.transport === "stdio" ? d.env ?? "" : d.headers ?? "").split("\n")) {
      const equal = line.indexOf("="); if (equal > 0) map[line.slice(0, equal)] = line.slice(equal + 1);
    }
    setCredentials(JSON.stringify(d.credentialValues ?? map, null, 2)); setOauth(d.oauth ?? {}); setWarnings(parsed.warnings);
    setPaste(""); setError(""); if (Object.keys(map).length || d.oauth) setAdvanced(true);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try {
      const suggested = transport === "stdio" ? command.trim().split(/[\\/]/).pop() || "Local tools" : new URL(url).hostname;
      const finalName = name.trim() || suggested; const finalId = entry?.id ?? sanitizeId(id || finalName);
      if (!entry && existingIds.includes(finalId)) throw new Error("A connection with this ID already exists. Choose another name or ID.");
      const common = { id: finalId, name: finalName, isDefault, selfServe, enabled: entry?.enabled ?? true,
        ...(entry?.description ? { description: entry.description } : {}),
        ...(entry?.toolNames ? { toolNames: entry.toolNames } : {}),
        ...(allowed.trim() ? { allowedTools: allowed.split(",").map(s => s.trim()).filter(Boolean) } : {}) };
      const map = readMap(credentials);
      if (transport === "stdio") {
        const argv: unknown = JSON.parse(args || "[]");
        if (!Array.isArray(argv) || argv.some(v => typeof v !== "string")) throw new Error("Arguments must be a JSON array of strings.");
        if (!command.trim()) throw new Error("Enter the command to start your server.");
        await onSave({ ...common, transport, command: command.trim(), args: argv, env: map });
      } else {
        const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Enter an HTTP or HTTPS server URL.");
        await onSave({ ...common, transport, url: url.trim(), headers: map, ...(Object.keys(oauth).length ? { oauth } : {}) });
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save connection."); }
  }
  return <form className="connection-form" onSubmit={e => { void submit(e); }}>
    <div className="connection-form-heading"><h3>{entry ? "Edit connection" : "Connect your tools"}</h3><p>Set up once. Use from any agent in this project.</p></div>
    {!entry && <div className="connection-paste"><label htmlFor="connection-paste">Have an install command or configuration?</label>
      <textarea id="connection-paste" value={paste} onChange={e => setPaste(e.target.value)} placeholder="Paste a server URL, add command, or JSON" rows={2} />
      <button type="button" disabled={!paste.trim() || busy} onClick={importPaste}>Import configuration</button></div>}
    {warnings.length > 0 && <ul className="connection-notice">{warnings.map(w => <li key={w}>{w}</li>)}</ul>}
    <fieldset className="connection-transport"><legend>Connection type</legend>
      <label><input type="radio" name="connection-type" checked={transport !== "stdio"} onChange={() => { setTransport("http"); setCredentials("{}"); }} />Remote URL</label>
      <label><input type="radio" name="connection-type" checked={transport === "stdio"} onChange={() => { setTransport("stdio"); setCredentials("{}"); }} />Local command</label>
    </fieldset>
    <label htmlFor="connection-name">Name <span className="connection-muted">optional</span></label><input id="connection-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Team documentation" />
    {transport === "stdio" ? <><label htmlFor="connection-command">Command</label><input id="connection-command" required value={command} onChange={e => setCommand(e.target.value)} placeholder="npx" />
      <ArgumentFields value={args} onChange={setArgs} />
      <p className="connection-notice">Saving and testing starts this command on the Swarmcrews host, with its user permissions. Local servers run from this project's source folder.</p></>
      : <><label htmlFor="connection-url">Server URL</label><input id="connection-url" type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
        <p className="connection-muted">We'll check the server. If it needs access to your account, you can sign in next.</p></>}
    <fieldset className="connection-availability"><legend>Context settings</legend>
      <label><input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Default</label>
      <p className="connection-muted">Preselect this connection for new runs.</p>
      <label><input type="checkbox" checked={selfServe} onChange={e => setSelfServe(e.target.checked)} /> Self-serve</label>
      <p className="connection-muted">Advertise this connection so agents can discover it when relevant. When off, select it explicitly to allow use.</p>
    </fieldset>
    <button type="button" className="connection-link" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}>{advanced ? "Hide" : "Show"} advanced settings</button>
    {advanced && <div className="connection-advanced">
      <label htmlFor="connection-id">Connection ID</label><input id="connection-id" value={id} disabled={Boolean(entry)} onChange={e => setId(e.target.value)} placeholder="Generated from the name" />
      <CredentialFields value={credentials} onChange={setCredentials} local={transport === "stdio"} />
      <p className="connection-muted">Stored privately on the Swarmcrews host. Masked values are kept unless you replace or remove them.</p>
      {transport !== "stdio" && <>
        <label htmlFor="connection-protocol">Remote protocol</label><select id="connection-protocol" value={transport} onChange={e => setTransport(e.target.value as "http" | "sse")}><option value="http">Streamable HTTP</option><option value="sse">Legacy SSE</option></select>
        <label htmlFor="connection-client-id">OAuth client ID (if supplied by your provider)</label><input id="connection-client-id" value={oauth.clientId ?? ""} onChange={e => setOauth({ ...oauth, clientId: e.target.value })} />
        <label htmlFor="connection-client-secret">OAuth client secret (optional)</label><input id="connection-client-secret" type="password" autoComplete="off" value={oauth.clientSecret ?? ""} onChange={e => setOauth({ ...oauth, clientSecret: e.target.value })} />
        <label htmlFor="connection-scope">OAuth scopes (optional)</label><input id="connection-scope" value={oauth.scope ?? ""} onChange={e => setOauth({ ...oauth, scope: e.target.value })} />
      </>}
      <label htmlFor="connection-allowed">Allowed tools (comma-separated, optional)</label><input id="connection-allowed" value={allowed} onChange={e => setAllowed(e.target.value)} placeholder="Leave empty to allow all discovered tools" />
    </div>}
    {error && <p role="alert" className="connection-error">{error}</p>}
    <p className="connection-muted">Selected connections enter the run's context and are inherited by child agents. Self-serve connections are available for on-demand discovery.</p>
    <div className="connection-actions"><button type="submit" className="connection-primary" disabled={busy}>{busy ? "Saving…" : entry?.enabled === false ? "Save changes" : "Save & test connection"}</button><button type="button" onClick={onCancel} disabled={busy}>Cancel</button></div>
  </form>;
}
