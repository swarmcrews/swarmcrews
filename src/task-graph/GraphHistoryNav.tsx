import type { TaskGraphHistory } from "./use-task-graph-history.ts";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ViewportOverlay } from "../components/ViewportOverlay.tsx";
import { AlertCircle, Check, ChevronDown, GitBranch, History, RotateCw, Undo2 } from "lucide-react";
import "../project-header.css";
import { containDialogFocus, dismissDialogMenu } from "./dialog-focus.ts";

export function GraphHistoryLoadingDialog({ navigation, onClose, noCurrentGraph = false }: {
  navigation: ReactNode;
  onClose: () => void;
  noCurrentGraph?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialog.current && dismissDialogMenu(event, dialog.current)) return;
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (dialog.current) containDialogFocus(event, dialog.current);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => { window.removeEventListener("keydown", onKeyDown, true); previous?.focus(); };
  }, [onClose]);
  return <ViewportOverlay zIndex={10_000} style={{ pointerEvents: "auto" }}>
    <div className="tg-backdrop">
      <div ref={dialog} className="tg-plan-dialog" role="dialog" aria-modal="true" aria-label="Graph history" tabIndex={-1}>
        <header className="tg-inspector__header"><h2>Graph history</h2>
          <button className="tg-close" aria-label="Close graph inspector" onClick={onClose}>×</button>
        </header>
        {navigation}
        {noCurrentGraph ? <p className="tg-plan-dialog__body">No current graph. Choose a past run to review.</p> : null}
      </div>
    </div>
  </ViewportOverlay>;
}

export function GraphHistoryNav({ history, currentRunId, onSelect, compact = false }: {
  history: TaskGraphHistory;
  currentRunId: string | null;
  onSelect: (runId: string | null) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = history.runs.find(run => run.graphRunId === (history.selectedRunId ?? currentRunId));
  const pastRuns = history.runs.filter(run => run.graphRunId !== currentRunId || run.graphRunId === history.selectedRunId);
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const panel = menu.current;
    // The top layer escapes canvas transforms and inspector overflow, while
    // retaining the menu inside the dialog's DOM for focus containment.
    if (panel.showPopover) panel.showPopover();
    else panel.removeAttribute("popover");
    const position = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(400, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 19;
      const above = rect.top - 19;
      const upward = below < 240 && above > below;
      Object.assign(panel.style, {
        width: `${width}px`, left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
        top: upward ? "auto" : `${rect.bottom + 7}px`,
        bottom: upward ? `${window.innerHeight - rect.top + 7}px` : "auto",
        maxHeight: `${Math.max(80, upward ? above : below)}px`,
      });
    };
    position();
    panel.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      panel.hidePopover?.();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return <nav className={`tg-history${compact ? " tg-history--compact" : ""}`} aria-label="Graph history">
    <div className="project-switcher tg-history__switcher" ref={root} onKeyDown={event => {
      if (!open) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        return;
      }
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault(); event.stopPropagation(); close(); return;
      }
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (index + 1) % items.length
        : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : null;
      if (next !== null) { event.preventDefault(); items[next]?.focus(); }
    }}>
      <button ref={trigger} type="button" className="project-switcher__trigger tg-history__trigger"
        aria-label={`Graph history: ${selected?.title ?? "Current graph"}`}
        title={`${selected?.title ?? "Graph history"}${history.selectedRunId ? " · Past run · Read only" : ""}`}
        aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
        onClick={() => setOpen(value => !value)}>
        {!compact ? <GitBranch size={16} aria-hidden="true" /> : null}
        <span className="tg-history__trigger-copy">
          <span className="tg-history__trigger-meta">
            {compact && (history.error || history.loading) ? <span
              className={`tg-history__eyebrow${history.error ? " tg-history__warning" : ""}`}
              role="status" title={history.error ?? undefined}>
              {history.error ? "History unavailable" : "Loading history…"}
            </span> : <span className="tg-history__eyebrow">{history.selectedRunId ? "Past graph" : "Current graph"}</span>}
            {selected && !(compact && history.error) ? <span className={`tg-run-status tg-run-status--${selected.status}`}>{selected.status}</span> : null}
          </span>
          <span className="project-switcher__name">{selected?.title ?? "Graph history"}</span>
        </span>
        <ChevronDown className="project-switcher__chevron" data-open={open || undefined} size={14} aria-hidden="true" />
      </button>
      {open ? <div ref={menu} id={menuId} popover="manual" className="project-switcher__menu tg-history__menu"
        role="menu" aria-label="Switch graph">
        <div className="project-switcher__label">Graph history</div>
        <div className="project-switcher__list">
          {[null, ...pastRuns].map(run => {
            const current = run === null;
            const checked = current ? !history.selectedRunId : history.selectedRunId === run.graphRunId;
            const context = run ?? history.runs.find(item => item.graphRunId === currentRunId);
            return <button key={run ? `run:${run.graphRunId}` : "current"} type="button" role="menuitemradio" tabIndex={-1}
              className="project-switcher__project" aria-checked={checked} title={context?.title}
              onClick={() => { close(); onSelect(run?.graphRunId ?? null); }}>
              <span className="project-switcher__project-icon" aria-hidden="true">
                {current ? <GitBranch size={16} /> : <History size={16} />}
              </span>
              <span className="project-switcher__project-copy">
                <span className="project-switcher__project-name">{context?.title ?? "Current graph"}</span>
                <span className="tg-history__context">
                  {context ? <span className={`tg-run-status tg-run-status--${context.status}`}>{context.status}</span> : null}
                  <span>{current ? "Current graph" : "Past run · Read only"}</span>
                </span>
                {context ? <time className="tg-history__date" dateTime={context.createdAt}>
                  {new Date(context.createdAt).toLocaleString()}
                </time> : <span className="tg-history__date">Latest plan and live updates</span>}
              </span>
              <span className="project-switcher__project-check" aria-hidden="true">{checked ? <Check size={14} /> : null}</span>
            </button>;
          })}
          {!pastRuns.length ? <div className="project-switcher__state">{history.loading ? "Loading past runs…"
            : history.error ? "Past runs could not be loaded. Retry to load history." : "No past runs yet"}</div> : null}
        </div>
      </div> : null}
    </div>
    {history.selectedRunId ? <div className="tg-history__past-actions">
      {!compact ? <span className="tg-history__note">Past run · Read only</span> : null}
      <button type="button" className={compact ? "tg-history__retry" : "tg-button"}
        aria-label="Return to current" title="Return to current" onClick={() => onSelect(null)}>
        {compact ? <Undo2 size={14} aria-hidden="true" /> : "Return to current"}
      </button>
    </div> : null}
    {!compact && history.loading ? <span className="tg-history__loading" role="status">Loading graph history…</span> : null}
    {history.error ? compact
      ? <button type="button" className="tg-history__retry" onClick={history.refresh}
        aria-label="Retry history" title={`${history.error} Retry history`}><RotateCw size={14} aria-hidden="true" /></button>
      : <div className="tg-history__feedback">
        <AlertCircle size={15} aria-hidden="true" />
        <span role={history.selectedRunId ? "alert" : "status"}>{history.error}</span>
        <button type="button" className="tg-history__retry" onClick={history.refresh}>
          <RotateCw size={14} aria-hidden="true" />Retry history
        </button>
      </div> : null}
  </nav>;
}
