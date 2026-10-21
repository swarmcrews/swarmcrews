import { useId } from "react";
import { Search, X } from "lucide-react";
import { LibraryLayoutSwitch } from "./LibraryLayoutSwitch.tsx";
import { LibrarySort } from "./LibrarySort.tsx";
import type { LibraryCollection } from "../../shared/project-library/index.ts";
import type { LibraryFilters } from "./model.ts";
interface Props {
  hideSearch?: boolean;
  hideSort?: boolean;
  hideLayout?: boolean;
  filters: LibraryFilters; collections: LibraryCollection[]; tags: string[];
  onChange: (value: Partial<LibraryFilters>) => void;
}
export function LibraryFilterBar({ filters, collections, tags, onChange, hideSearch = false, hideSort = false, hideLayout = false }: Props) {
  const collectionId = useId(); const tagId = useId();
  const collectionName = collections.find(c => c.id === filters.collection)?.name ?? "Collection unavailable";
  const filtered = Boolean(filters.query || filters.collection || filters.tag);
  return <>
    <div className={`pl-filters${hideSort ? " pl-filters--search-first" : ""}${filters.view === "focus" && !hideSort ? " pl-filters--focus" : filters.view === "library" ? " pl-filters--index" : ""}`}>
      {!hideSearch && <label className="pl-search"><span className="pl-sr-only">Search projects</span><span className="pl-search-field"><Search size={16} aria-hidden="true" /><input type="search" value={filters.query} placeholder="Search name, path or tag…" onChange={e => onChange({ query: e.target.value })} /></span></label>}
      <label><span className="pl-sr-only">Collection</span><select aria-describedby={filters.collection ? collectionId : undefined} value={filters.collection} onChange={e => onChange({ collection: e.target.value })}><option value="">All collections</option>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label><span className="pl-sr-only">Tag</span><select aria-describedby={filters.tag ? tagId : undefined} value={filters.tag} onChange={e => onChange({ tag: e.target.value })}><option value="">All tags</option>{tags.map(tag => <option key={tag}>{tag}</option>)}</select></label>
      {filters.view !== "focus" && !hideSort && <LibrarySort filters={filters} onChange={onChange} />}
      <div className="pl-filter-actions">{!hideLayout && filters.view !== "library" && <LibraryLayoutSwitch filters={filters} onChange={onChange} />}{filtered && <button className="pl-clear-filters" type="button" title="Clear search and filters" aria-label="Clear search and filters" onClick={() => onChange({ query: "", collection: "", tag: "" })}><X size={16} aria-hidden="true" /></button>}</div>
    </div>
    {(filters.collection || filters.tag) && <div className="pl-filter-reset" role="group" aria-label="Active filters">
      {filters.collection && <button className="pl-filter-chip" type="button" aria-label={`Remove collection filter ${collectionName}`} onClick={() => onChange({ collection: "" })}>Collection: <span id={collectionId}>{collectionName}</span><X size={14} aria-hidden="true" /></button>}
      {filters.tag && <button className="pl-filter-chip" type="button" aria-label={`Remove tag filter ${filters.tag}`} onClick={() => onChange({ tag: "" })}>Tag: <span id={tagId}>{filters.tag}</span><X size={14} aria-hidden="true" /></button>}
    </div>}
  </>;
}
