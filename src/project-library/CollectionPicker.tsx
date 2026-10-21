import { Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LibraryCollection } from "../../shared/project-library/index.ts";
import { createCollection } from "./api.ts";

export function CollectionPicker({ collections, selected, disabled, onChange, onCreated, onBusy }: {
  collections: LibraryCollection[]; selected: string[]; disabled: boolean;
  onChange: (ids: string[]) => void; onCreated?: ((collection: LibraryCollection) => void) | undefined; onBusy: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState(""); const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false); const pending = useRef(false); const input = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => { if (!creating && restoreFocus.current) { restoreFocus.current = false; input.current?.focus(); } }, [creating]);
  const name = query.trim(); const normalized = name.toLocaleLowerCase();
  const matches = collections.filter(c => c.name.toLocaleLowerCase().includes(normalized));
  const exact = collections.some(c => c.name.toLocaleLowerCase() === normalized);
  const create = async () => {
    if (!name || exact || disabled || pending.current || !onCreated) return;
    pending.current = true; setCreating(true); onBusy(true); setError(null);
    try {
      const collection = await createCollection(name);
      onCreated(collection); onChange([...new Set([...selected, collection.id])]); setQuery("");
    } catch (err) { setError(`Couldn’t create collection. ${err instanceof Error ? err.message : "Try again."}`); }
    finally { pending.current = false; restoreFocus.current = true; setCreating(false); onBusy(false); }
  };
  return <fieldset className="pl-collection-picker" disabled={disabled || creating}><legend>Collections</legend>
    <label className="pl-picker-search"><span className="pl-sr-only">Find or create collection</span><Search size={16} aria-hidden="true" /><input ref={input} type="search" maxLength={200} placeholder="Find or create collection…" value={query} onChange={e => { setQuery(e.target.value); setError(null); }} /></label>
    <div className="pl-chips">{matches.map(c => <label className="pl-check" key={c.id}><input type="checkbox" checked={selected.includes(c.id)} onChange={e => onChange(e.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id))} />{c.name}</label>)}</div>
    {!collections.length && !name && <p className="pl-hint">Group related projects. Type a name to create your first collection.</p>}
    {!!collections.length && !matches.length && <p className="pl-hint">No matching collections.</p>}
    {name && !exact && onCreated && <div className="pl-create-collection"><button type="button" aria-label={`Create collection ${name}`} onClick={() => void create()}><Plus size={16} aria-hidden="true" />{creating ? "Creating…" : `Create “${name}”`}</button><p className="pl-hint">Creates the collection now. Project membership is saved with your edits.</p></div>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
