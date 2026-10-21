import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { LibraryFilters } from "./model.ts";
import "./library-mobile.css";

interface Props {
  filters: LibraryFilters;
  counts: Record<LibraryFilters["view"], number>;
  loaded: boolean;
  unread: number;
  actions?: ReactNode;
  children: ReactNode;
  onChange: (value: Partial<LibraryFilters>) => void;
}

/** Two touch-sized rows; organization controls consume space only when requested. */
export function MobileLibraryControls({ filters, counts, loaded, unread, actions, children, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const summaryId = useId();
  const active = Number(Boolean(filters.collection)) + Number(Boolean(filters.tag));
  return <>
    <div className="pl-mobile-toolbar">
      <div className="pl-mobile-row">
        <select aria-label="Project view" value={filters.view} onChange={e => onChange({ view: e.target.value as LibraryFilters["view"] })}>
          {([['library', 'Library'], ['focus', 'Focus desk'], ['archived', 'Archived']] as const).map(([view, label]) =>
            <option key={view} value={view}>{label}{loaded ? ` (${counts[view]})` : ""}</option>)}
        </select>
        {actions}
      </div>
      <div className="pl-mobile-row">
        <label className="pl-mobile-search">
          <span className="pl-mobile-sr-only">Search projects</span>
          <Search size={16} aria-hidden="true" />
          <input type="search" value={filters.query} placeholder="Search projects" onChange={e => onChange({ query: e.target.value })} />
        </label>
        <button type="button" className="pl-mobile-toggle" aria-label="Filters and tools" aria-describedby={summaryId} aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span>Filters{active > 0 ? ` (${active})` : ""}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      <span id={summaryId} className="pl-mobile-sr-only">{active} active filters. {unread} unread updates. Sorting and project tools.</span>
    </div>
    <div id={panelId} hidden={!expanded} className="pl-mobile-panel">{expanded && children}</div>
  </>;
}
