import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plug, X } from "lucide-react";
import type { SandboxPolicy } from "../../shared/workspace-contracts.ts";
import { SandboxPolicyControls } from "../nodes/leader/SandboxPolicyControls.tsx";
import { useHarnessList } from "../use-harness-list.tsx";
import { findHarness } from "../harness-list.ts";
import { ConnectionsPanel } from "./ConnectionsPanel.tsx";
import { useConnections } from "./use-connections.ts";
import "./connections.css";

export function ConnectionsPicker({ projectId, connectionIds, onChange, policy, onPolicyChange, harness = "claude" }: {
  projectId?: string | null | undefined;
  connectionIds?: string[] | undefined;
  onChange: (ids: string[]) => void;
  policy?: SandboxPolicy | undefined;
  onPolicyChange: (policy: SandboxPolicy) => void;
  harness?: string | undefined;
}) {
  const { project, entries, loaded, error, refresh } = useConnections(projectId);
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [search, setSearch] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const { harnesses, loaded: harnessesLoaded } = useHarnessList();
  const support = harnessesLoaded ? findHarness(harnesses, harness)?.capabilities.sandboxEnforcement ?? null : undefined;
  const selected = connectionIds ?? entries.filter(e => e.enabled !== false && e.isDefault === true).map(e => e.id);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  useEffect(() => {
    if (loaded && !error && connectionIds === undefined) onChangeRef.current(entries.filter(e => e.enabled !== false && e.isDefault === true).map(e => e.id));
  }, [loaded, error, connectionIds, entries]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    return () => { button.current?.focus(); };
  }, [open]);
  return <>
    <button ref={button} type="button" className="leader-node__skills-button" data-active={selected.length > 0}
      aria-label={`Configure connections${selected.length ? `, ${selected.length} selected` : ""}`} aria-haspopup="dialog" aria-expanded={open}
      title={`Connections · ${selected.length} selected`} onMouseDown={e => e.stopPropagation()} onClick={() => setOpen(true)}>
      <Plug size={13} aria-hidden="true" /><span>Connections</span><strong>{selected.length}</strong>
    </button>
    {open && createPortal(<div className="connections-picker-backdrop" onMouseDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) setOpen(false); }}>
      <div ref={dialog} className="connections-picker" role="dialog" aria-modal="true" aria-label="Select MCP connections" tabIndex={-1}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          if (e.key === "Tab") {
            const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? []);
            const first = elements[0]; const last = elements.at(-1);
            if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
          }
        }}>
        <header><h2>MCP Connections</h2><button type="button" aria-label="Close connections" onClick={() => setOpen(false)}><X size={18} /></button></header>
        <p>Select connections to add them to this run's context. Self-serve connections remain discoverable when unselected. Changes apply on the next turn.</p>
        <div className="connection-actions"><button type="button" onClick={() => setManage(v => !v)}>{manage ? "Select connections" : "Manage connections"}</button></div>
        {manage && project ? <ConnectionsPanel key={project} projectId={project} /> : <>
          <input aria-label="Search connections" type="search" placeholder="Search connections" value={search} onChange={e => setSearch(e.target.value)} />
          {error && <p role="alert">{error} <button type="button" onClick={refresh}>Retry</button></p>}
          {!project ? <p>Open a project to select connections.</p> : !loaded ? <p role="status">Loading connections…</p> : entries.length === 0 && !error ? <p>No connections yet. Add one in Manage connections.</p> : null}
          <div className="connections-picker-list">{entries.filter(e => `${e.name} ${e.description ?? ""}`.toLowerCase().includes(search.toLowerCase())).map(entry => <label key={entry.id}>
            <input type="checkbox" checked={selected.includes(entry.id)} disabled={entry.enabled === false && !selected.includes(entry.id)}
              onChange={e => onChange(e.target.checked ? [...selected, entry.id] : selected.filter(id => id !== entry.id))} />
            <span><strong>{entry.name}</strong><small>{entry.enabled === false ? "Disabled" : selected.includes(entry.id) ? "Added to context" : entry.selfServe === false ? "Select to allow use" : "Available for self-serve"}{entry.isDefault && " · Default"}</small>{entry.description && <small>{entry.description}</small>}</span>
          </label>)}</div>
        </>}
        <SandboxPolicyControls policy={policy} support={support} mcpAvailable={entries.some(e => e.enabled !== false && (selected.includes(e.id) || e.selfServe !== false))} onChange={onPolicyChange} />
      </div>
    </div>, document.body)}
  </>;
}
