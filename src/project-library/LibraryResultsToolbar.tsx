import { LibraryLayoutSwitch } from "./LibraryLayoutSwitch.tsx";
import { LibraryPagination } from "./LibraryPagination.tsx";
import { LibrarySort } from "./LibrarySort.tsx";
import type { LibraryFilters } from "./model.ts";

export function LibraryResultsToolbar({ filters, total, page, compact, onChange, onPage }: { filters: LibraryFilters; total: number; page: number; compact: boolean; onChange: (value: Partial<LibraryFilters>) => void; onPage: (page: number) => void }) {
  return <div className="pl-results-toolbar" tabIndex={-1} role="region" aria-label={filters.view === "archived" ? "Archived project results" : "Focus desk results"}>
    <div className="pl-results-controls"><p className="pl-result-count">{total} {total === 1 ? "project" : "projects"}{filters.view === "focus" ? " on your desk" : " archived"}</p>
      {!compact && <div className="pl-results-options">{filters.view === "archived" && <LibrarySort filters={filters} onChange={onChange} />}<LibraryLayoutSwitch filters={filters} onChange={onChange} /></div>}
    </div>
    <LibraryPagination page={page} total={total} position="top" onPage={onPage} />
  </div>;
}
