import { NavigationDraft } from "../navigation-drafts.tsx";
import { useEffect, useRef, useState } from "react";
import type { LibraryCollection } from "../../shared/project-library/index.ts";
import { createCollection, deleteCollection, renameCollection } from "./api.ts";
import { LibraryDialog } from "./LibraryDialog.tsx";
export function CollectionsDialog({ collections, onChanged, onClose }: { collections: LibraryCollection[]; onChanged: () => Promise<boolean>; onClose: () => void }) {
  const [name, setName] = useState(""); const [selected, setSelected] = useState<string | null>(null); const [deleteId, setDeleteId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null); const previousSelection = useRef(selected);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  useEffect(() => { if (!busy && previousSelection.current !== selected) { input.current?.focus(); input.current?.select(); previousSelection.current = selected; } }, [selected, busy]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [nextScope, setNextScope] = useState<{ id: string | null; name: string } | null>(null);
  const selectedUnavailable = !!selected && !collections.some(c => c.id === selected);
  const dirty = selected ? name !== collections.find(c => c.id === selected)?.name : !!name;
  const switchScope = (id: string | null, value: string) => { setSelected(id); setName(value); setDeleteId(null); setNextScope(null); setError(null); };
  const requestScope = (id: string | null, value: string) => { if (id === selected) return; if (dirty) { setConfirmClose(false); setNextScope({ id, name: value }); } else switchScope(id, value); };
  const run = async (action: () => Promise<unknown>, clearDraft = true) => {
    if (busy || needsRefresh) return; setBusy(true); setError(null);
    try { await action(); if (clearDraft) { setName(""); setSelected(null); } setDeleteId(null); setNextScope(null); setNeedsRefresh(!await onChanged()); }
    catch (err) { setError(`Your input is preserved. Retry the action above. ${err instanceof Error ? err.message : "Couldn’t update collections"}`); }
    finally { setBusy(false); }
  };
  const editor = <form onSubmit={e => { e.preventDefault(); if (name.trim() && !selectedUnavailable) void run(() => selected ? renameCollection(selected, name.trim()) : createCollection(name.trim())); }}><label>{selected ? "Collection name" : "New collection name"}<input ref={input} placeholder={selected ? "Collection name" : "Name a new collection…"} value={name} maxLength={200} disabled={busy || needsRefresh} onChange={e => setName(e.target.value)} /></label><footer><button className="pl-action--primary" type="submit" disabled={busy || needsRefresh || !name.trim() || selectedUnavailable}>{busy ? "Saving…" : selected ? "Save collection name" : "Create collection"}</button>{selected && <button type="button" disabled={busy || needsRefresh} onClick={() => requestScope(null, "")}>Cancel rename</button>}</footer></form>;
  return <LibraryDialog title="Collections" sheet busy={busy} onClose={() => { setNextScope(null); if (dirty) setConfirmClose(true); else onClose(); }}><NavigationDraft scope="collections" dirty={dirty} pending={busy} failed={needsRefresh} /><p className="pl-hint">Group related projects. A project can belong to more than one collection.</p>
    {collections.length === 0 && !selected && <p className="pl-hint">No collections yet. Create your first one below.</p>}
    {collections.map(c => <div className="pl-collection-row" key={c.id}>{selected === c.id ? editor : <span>{c.name}</span>}<button type="button" hidden={selected === c.id} disabled={busy || needsRefresh} aria-label={`Rename ${c.name}`} onClick={() => requestScope(c.id, c.name)}>Rename</button><button type="button" disabled={busy || needsRefresh} aria-label={`Delete ${c.name}`} onClick={() => setDeleteId(c.id)}>Delete</button></div>)}
    {selectedUnavailable && <p role="alert">This collection is no longer available. Your draft is preserved. Cancel rename to continue.</p>}
    {(!selected || selectedUnavailable) && editor}
    {deleteId && <div role="alert"><p>Delete “{collections.find(c => c.id === deleteId)?.name}”? Only the grouping and its memberships are removed.</p><button className="pl-action--danger" type="button" disabled={busy || needsRefresh} onClick={() => void run(() => deleteCollection(deleteId), selected === deleteId)}>Confirm delete collection</button><button type="button" disabled={busy || needsRefresh} onClick={() => setDeleteId(null)}>Keep collection</button></div>}
    {nextScope && <div role="alert"><p>Unsaved collection edits. Keep editing or discard them before switching.</p><button type="button" onClick={() => setNextScope(null)}>Keep editing</button><button type="button" onClick={() => switchScope(nextScope.id, nextScope.name)}>Discard and switch</button></div>}
    {confirmClose && <div role="alert"><p>Unsaved collection edits. Keep editing or explicitly discard them.</p><button type="button" onClick={() => setConfirmClose(false)}>Keep editing</button><button type="button" onClick={onClose}>Discard collection edits</button></div>}
    {error && <p role="alert">{error}</p>}
    {needsRefresh && <p role="alert">Collection change saved, but the latest Library could not be loaded. Do not repeat the saved action.<button type="button" disabled={busy} onClick={() => { setBusy(true); void onChanged().then(ok => setNeedsRefresh(!ok)).finally(() => setBusy(false)); }}>Refresh collections</button></p>}
  </LibraryDialog>;
}
