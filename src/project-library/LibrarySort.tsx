import type { LibraryFilters } from "./model.ts";

export function LibrarySort({ filters, onChange }: { filters: LibraryFilters; onChange: (value: Partial<LibraryFilters>) => void }) {
  return <label className="pl-sort"><span>Sort</span><select aria-label="Sort projects" value={filters.sort} onChange={e => onChange({ sort: e.target.value as LibraryFilters["sort"] })}>
    <option value="activity">{filters.view === "library" ? "Recent activity" : "Last opened"}</option>
    <option value="name">Name</option><option value="created">Newest registered</option>
  </select></label>;
}
