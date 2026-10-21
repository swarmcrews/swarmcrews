import { LayoutGrid, List } from "lucide-react";
import { projectLayout, type LibraryFilters } from "./model.ts";

export function LibraryLayoutSwitch({ filters, onChange }: { filters: LibraryFilters; onChange: (value: Partial<LibraryFilters>) => void }) {
  const view = filters.view === "archived" ? "archived" : "focus";
  return <div className="pl-layout-switch" role="group" aria-label="Project layout">
    {([ ["list", "List", List], ["grid", "Grid", LayoutGrid] ] as const).map(([layout, label, Icon]) => <button key={layout} type="button" title={label} aria-pressed={projectLayout(filters) === layout} onClick={() => onChange({ layouts: { ...filters.layouts, [view]: layout } })}><Icon size={16} aria-hidden="true" /><span className="pl-sr-only">{label}</span></button>)}
  </div>;
}
