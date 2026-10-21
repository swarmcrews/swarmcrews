import { Ellipsis, Layers, RefreshCw } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Secondary maintenance stays discoverable without competing with projects. */
export function LibraryTools({ help, actions, disabled, refreshing, onRefresh, onCleanup, onManageCollections, inline = false }: {
  help: string; actions?: ReactNode; inline?: boolean; disabled: boolean; refreshing: boolean; onRefresh: () => void; onCleanup: () => void; onManageCollections: () => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false; };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const collapse = () => { if (ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } };
  const controls = <>
    <button type="button" onClick={() => { collapse(); onManageCollections(); }}><Layers size={16} aria-hidden="true" />Manage collections</button>
    <button type="button" disabled={disabled} onClick={() => { collapse(); onCleanup(); }}>Clean up missing folders</button>
    <button className="pl-refresh" type="button" disabled={refreshing} onClick={() => { collapse(); onRefresh(); }}><RefreshCw size={16} aria-hidden="true" />Refresh Library</button>
    {actions}
  </>;
  if (inline) return <div className="pl-heading-actions">{controls}</div>;
  return <details className="pl-tools" ref={ref} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); if (ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } }
  }}><summary aria-label="Library tools"><Ellipsis size={20} aria-hidden="true" /><span>Tools</span></summary>
    <div className="pl-tools-popover">
      <p className="pl-hint">{help}</p>
      {controls}
    </div>
  </details>;
}
