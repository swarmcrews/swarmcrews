import { useEffect, useRef, useState } from "react";
import type { LibraryProject } from "../../shared/project-library/index.ts";
import type { MissingProject } from "../../shared/project-library/cleanup.ts";
import { NavigationDraft } from "../navigation-drafts.tsx";
import { cleanupMissingFolders, getLibrary, scanMissingFolders } from "./api.ts";
import { LibraryDialog } from "./LibraryDialog.tsx";
import "./missing-projects.css";

type Candidate = MissingProject & { name: string; path: string; reason?: string };
export function MissingProjectsDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<boolean> }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(true); const [progress, setProgress] = useState("Checking folders…");
  const [error, setError] = useState<string | null>(null); const [result, setResult] = useState<string | null>(null);
  const [needsScan, setNeedsScan] = useState(true); const [needsRefresh, setNeedsRefresh] = useState(false);
  const [query, setQuery] = useState(""); const [page, setPage] = useState(0);
  const scanning = useRef<AbortController | null>(null); const submitting = useRef(false);
  async function scan() {
    scanning.current?.abort(); const controller = new AbortController(); scanning.current = controller;
    setBusy(true); setNeedsScan(true); setError(null); setResult(null); setProgress("Checking folders…");
    setSelected(new Set()); setCandidates([]); setPage(0);
    try {
      const library = await getLibrary(controller.signal); const projects = library.projects.filter(p => !p.archived);
      const byId = new Map<string, LibraryProject>(projects.map(p => [p.id, p])); const found: Candidate[] = [];
      for (let offset = 0; offset < projects.length; offset += 100) {
        const batch = await scanMissingFolders(projects.slice(offset, offset + 100).map(p => p.id), controller.signal);
        if (controller.signal.aborted) return;
        found.push(...batch.map(p => ({ ...p, name: byId.get(p.id)!.name, path: byId.get(p.id)!.path })));
        setProgress(`Checked ${Math.min(offset + 100, projects.length)} of ${projects.length} folders…`);
      }
      if (controller.signal.aborted) return;
      setCandidates(found); setSelected(new Set(found.filter(p => p.eligible).map(p => p.id))); setNeedsScan(false);
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn’t check folders"); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  useEffect(() => { void scan(); return () => scanning.current?.abort(); }, []);
  async function cleanup() {
    if (busy || submitting.current || needsScan || needsRefresh || !selected.size) return;
    submitting.current = true; setBusy(true); setError(null); setResult(null);
    const chosen = candidates.filter(p => selected.has(p.id) && p.eligible);
    let archived = 0; let skipped = 0;
    try {
      for (let offset = 0; offset < chosen.length; offset += 100) {
        setProgress(`Archiving ${offset + 1}–${Math.min(offset + 100, chosen.length)} of ${chosen.length} projects…`);
        const outcome = await cleanupMissingFolders(chosen.slice(offset, offset + 100).map(p => ({ id: p.id, expectedRevision: p.revision })));
        archived += outcome.archived.length; skipped += outcome.skipped.length;
        const removed = new Set(outcome.archived); const blocked = new Map(outcome.skipped.map(p => [p.id, p.reason]));
        setCandidates(prev => prev.filter(p => !removed.has(p.id)).map(p => blocked.has(p.id) ? { ...p, eligible: false, reason: blocked.get(p.id)! } : p));
        setSelected(prev => new Set([...prev].filter(id => !removed.has(id) && !blocked.has(id))));
      }
      setResult(`Archived ${archived} ${archived === 1 ? "project" : "projects"}. ${skipped ? `Skipped ${skipped}; review the reasons below. ` : ""}Restore from Archived at any time.`);
      setPage(0);
    } catch (err) {
      setNeedsScan(true);
      setError(`${archived} confirmed archived. The last batch could not be confirmed. Scan again before retrying. ${err instanceof Error ? err.message : "Connection failed"}`);
    } finally {
      try { setNeedsRefresh(!await onChanged()); } catch { setNeedsRefresh(true); }
      setBusy(false); submitting.current = false;
    }
  }
  const matching = candidates.filter(p => `${p.name} ${p.path}`.toLowerCase().includes(query.toLowerCase()));
  const visible = matching.slice(page * 25, (page + 1) * 25);
  const eligible = matching.filter(p => p.eligible);
  const allSelected = eligible.length > 0 && eligible.every(p => selected.has(p.id));
  return <LibraryDialog title="Clean up missing folders" busy={busy && submitting.current} onClose={onClose} footer={<>
    <button type="button" disabled={busy && submitting.current} onClick={onClose}>{result ? "Done" : "Cancel"}</button>
    <button type="button" disabled={busy} onClick={() => void scan()}>Scan again</button>
    <button className="pl-action--primary" type="button" disabled={busy || needsScan || needsRefresh || !selected.size} onClick={() => void cleanup()}>Archive {selected.size} missing {selected.size === 1 ? "project" : "projects"}</button>
  </>}>
    <NavigationDraft scope="missing-folder-cleanup" pending={busy && submitting.current} failed={needsRefresh} />
    <p>Hide projects whose registered folders no longer exist on this server. Files, workspace identity and history are preserved. You can restore projects from Archived.</p>
    <p className="pl-hint">Disconnected drives can look missing. Reconnect them before scanning if you want to keep those projects. Active, unresolved or unknown work is never archived; every selection is checked again before saving.</p>
    {busy && <p role="status">{progress}</p>}
    {error && <p role="alert">{error}</p>}
    {result && <p role="status">{result}</p>}
    {needsRefresh && <p role="alert">Library refresh failed. Don’t repeat cleanup; refresh to see saved changes. <button type="button" disabled={busy} onClick={() => { setBusy(true); void onChanged().then(ok => setNeedsRefresh(!ok)).catch(() => setNeedsRefresh(true)).finally(() => setBusy(false)); }}>Refresh Library</button></p>}
    {!busy && !needsScan && !candidates.length && <p>No missing folders to clean up.</p>}
    {candidates.length > 0 && <>
      <p>{candidates.length} missing folders · {candidates.filter(p => !p.eligible).length} blocked · {selected.size} selected</p>
      <label>Filter missing folders<input type="search" value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      <label className="pl-check"><input type="checkbox" checked={allSelected} disabled={busy || !eligible.length || needsScan} onChange={() => setSelected(prev => { const next = new Set(prev); for (const p of eligible) { if (allSelected) next.delete(p.id); else next.add(p.id); } return next; })} />Select all matching eligible projects</label>
      <ul className="pl-missing-list">{visible.map(p => <li key={p.id}><label className="pl-check"><input type="checkbox" aria-label={`Select ${p.name} (${p.path})`} checked={selected.has(p.id)} disabled={busy || !p.eligible || needsScan} onChange={() => setSelected(prev => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })} /><span><strong>{p.name}</strong><span className="pl-missing-path">{p.path}</span>{!p.eligible && <span className="pl-missing-reason">{p.reason ?? "Active, unresolved or unknown work — resolve in Activity, then scan again."}</span>}</span></label></li>)}</ul>
      {!matching.length && <p>No missing folders match this filter.</p>}
      {matching.length > 25 && <div className="pl-missing-pages"><button type="button" disabled={busy || page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>{page * 25 + 1}–{Math.min((page + 1) * 25, matching.length)} of {matching.length}</span><button type="button" disabled={busy || (page + 1) * 25 >= matching.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}
    </>}
  </LibraryDialog>;
}
