import { NavigationDraft } from "../navigation-drafts.tsx";
import { Check, Circle, Pencil } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { LibraryCollection, LibraryProject } from "../../shared/project-library/index.ts";
import { LibraryApiError, saveLibraryProject } from "./api.ts";
import { LibraryDialog } from "./LibraryDialog.tsx";
import { TagPicker, mergeTags } from "./TagPicker.tsx";
import { CollectionPicker } from "./CollectionPicker.tsx";
const fields = (p: LibraryProject) => ({ name: p.displayName ?? p.name, description: p.description, tags: p.tags, collectionIds: p.collectionIds });
export function ProjectDetails({ project, collections, suggestions = [], onCollectionCreated, onSaved, onClose, reload, organization }: {
  project: LibraryProject; collections: LibraryCollection[]; suggestions?: string[];
  onCollectionCreated?: ((collection: LibraryCollection) => void) | undefined;
  onSaved: (p: LibraryProject) => void; onClose: () => void; reload: () => Promise<boolean>; organization: ReactNode;
}) {
  const lastEditor = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [baseline, setBaseline] = useState(fields(project)); const [draft, setDraft] = useState(baseline);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false); const [creating, setCreating] = useState(false);
  const busy = saving || creating;
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false); const [conflict, setConflict] = useState(false);
  const [conflictReady, setConflictReady] = useState(true);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || !!tagInput.trim();
  const missing = draft.collectionIds.filter(id => !collections.some(c => c.id === id));
  const save = async () => {
    if (busy || !dirty || missing.length || !conflictReady) return;
    setSaving(true); setError(null);
    try {
      const updated = await saveLibraryProject(project.id, { expectedRevision: project.revision, displayName: draft.name.trim() || null, description: draft.description, tags: mergeTags(draft.tags, tagInput), collectionIds: draft.collectionIds });
      const saved = fields(updated); setBaseline(saved); setDraft(saved); setTagInput(""); setConflict(false); onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save details");
      if (err instanceof LibraryApiError && err.code === "REVISION_CONFLICT") { setConflict(true); setConflictReady(await reload()); }
    } finally { setSaving(false); }
  };
  const footer = <>
    <span className="pl-footer-status" role="status" data-dirty={dirty}>{dirty ? <Circle size={8} fill="currentColor" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{dirty ? "Unsaved edits" : "All changes saved"}</span>
    <button type="button" disabled={busy || !dirty} onClick={() => { setDraft(fields(project)); setBaseline(fields(project)); setTagInput(""); setError(null); setConflict(false); setConflictReady(true); }}>Discard changes</button>
    <button className="pl-action--primary" type="button" disabled={busy || !dirty || !!missing.length || !conflictReady} onClick={() => void save()}>{saving ? "Saving…" : error ? "Retry save" : "Save changes"}</button>
  </>;
  return <LibraryDialog sheet onFocusCapture={e => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) lastEditor.current = e.target; }} className="pl-dialog--details" title={project.name} titleContent={<label className="pl-editable-title"><span className="pl-sr-only">Display name</span><input maxLength={200} value={draft.name} disabled={busy} onChange={e => setDraft({ ...draft, name: e.target.value })} /><Pencil size={16} aria-hidden="true" /></label>} busy={busy} footer={footer} onClose={() => dirty ? setConfirmClose(true) : onClose()}>
    <NavigationDraft scope="project-details" dirty={dirty} pending={busy} />
    <label className="pl-description-editor"><span className="pl-sr-only">Description</span><textarea maxLength={2000} placeholder="Add a description…" value={draft.description} disabled={busy} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
    <div className="pl-identity"><label>Repository path<output className="pl-full-value">{project.path}</output></label><p className="pl-hint">Metadata only · repository identity and work history stay unchanged.</p></div>
    <TagPicker tags={draft.tags} input={tagInput} suggestions={suggestions} disabled={busy} onInput={setTagInput} onChange={tags => setDraft(prev => ({ ...prev, tags }))} />
    <CollectionPicker collections={collections} selected={draft.collectionIds} disabled={busy} onBusy={setCreating} onCreated={onCollectionCreated} onChange={collectionIds => setDraft(prev => ({ ...prev, collectionIds }))} />
    {missing.length > 0 && <div role="alert">A selected collection was deleted. <button type="button" disabled={busy} onClick={() => setDraft({ ...draft, collectionIds: draft.collectionIds.filter(id => collections.some(c => c.id === id)) })}>Remove unavailable collections</button></div>}
    {error && <div role="alert">Save failed. Your edits are preserved. {error}{conflict && (conflictReady ? <p>Latest revision loaded. Review your edits before retrying; saving will replace these metadata fields only.</p> : <p>Latest revision could not be loaded. Your draft is preserved.<button type="button" disabled={busy} onClick={() => { setSaving(true); void reload().then(setConflictReady).finally(() => setSaving(false)); }}>Refresh latest revision</button></p>)}</div>}
    {confirmClose && <div role="alert"><p>Unsaved changes. Keep editing or explicitly discard them.</p><button type="button" disabled={busy} onClick={() => { setConfirmClose(false); lastEditor.current?.focus(); }}>Keep editing</button><button type="button" disabled={busy} onClick={onClose}>Discard and close</button></div>}
    <fieldset disabled={dirty || busy}><legend>Organization</legend>{dirty && <p className="pl-hint">Save or discard edits before changing organization or opening work.</p>}{organization}</fieldset>
  </LibraryDialog>;
}
