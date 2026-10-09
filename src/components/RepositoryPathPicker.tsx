import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowRight, ArrowUp, Check, ChevronRight, Folder, FolderOpen, MapPin, X } from "lucide-react";
import { getRepositoryPathSuggestions } from "../api.ts";
import type { RepositoryDirectory, RepositoryPathSuggestions } from "../../shared/repository-paths.ts";
import "./repository-path-picker.css";

interface RepositoryPathPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  onSubmit?: () => void;
}

type Lookup = { path: string; mode: "complete" | "browse"; delay: number };

function folderErrorMessage(error: string): string {
  const apiError = /^API error \d+: ([\s\S]*)$/.exec(error);
  if (!apiError) return error;
  try {
    const body: unknown = JSON.parse(apiError[1]!);
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      if (body.error === "Folder is unavailable or outside configured browse roots") {
        return "This folder is unavailable or outside the server’s browsing locations. Choose Browse locations, or check the folder’s permissions and SWARMCREWS_BROWSE_ROOTS on the server.";
      }
      return body.error;
    }
  } catch { /* A proxy may return HTML rather than a JSON error. */ }
  return "Could not load folders from the server. Try Browse locations or retry shortly.";
}

/** All filesystem navigation comes from the server; paths remain opaque here. */
export function RepositoryPathPicker({
  value, onChange, disabled = false, placeholder = "Type or paste a repository path",
  autoFocus = false, className = "", onSubmit,
}: RepositoryPathPickerProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const suppressFocus = useRef(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isUntrustedRequest = error !== null
    && error.startsWith("API error 403:")
    && /"error"\s*:\s*"(?:Untrusted origin or host|Forbidden)"/.test(error);
  const [result, setResult] = useState<RepositoryPathSuggestions | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const open = lookup !== null && !disabled;
  const entries = !loading && !error ? result?.entries ?? [] : [];

  function invalidate() {
    requestId.current++;
    controller.current?.abort();
  }

  function close() {
    invalidate();
    setLookup(null);
    setActiveIndex(-1);
    setLoading(false);
  }

  function focusInput() {
    suppressFocus.current = true;
    inputRef.current?.focus();
    suppressFocus.current = false;
  }

  function request(path: string, mode: Lookup["mode"], delay = 0) {
    if (disabled) return;
    // Invalidate immediately, including the debounce interval before the next
    // fetch starts. A previous result must never replace newly typed text.
    invalidate();
    setResult(null);
    setError(null);
    setActiveIndex(-1);
    setLoading(true);
    setLookup({ path, mode, delay });
  }

  useEffect(() => {
    if (!lookup || disabled) return;
    const current = ++requestId.current;
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(() => {
      void getRepositoryPathSuggestions({ path: lookup.path, mode: lookup.mode }, abort.signal)
        .then((next) => {
          if (abort.signal.aborted || current !== requestId.current) return;
          setResult(next);
          setActiveIndex(next.entries.length ? 0 : -1);
        })
        .catch((reason: unknown) => {
          if (abort.signal.aborted || current !== requestId.current) return;
          setError(reason instanceof Error ? reason.message : "Could not load folders");
        })
        .finally(() => {
          if (!abort.signal.aborted && current === requestId.current) setLoading(false);
        });
    }, lookup.delay);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [lookup, disabled]);

  // Keep keyboard navigation inside the list's scroll area. scrollIntoView
  // would also move the surrounding form/page and hide the path input.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.children[activeIndex];
    if (!list || !row) return;
    const bounds = list.getBoundingClientRect();
    const active = row.getBoundingClientRect();
    if (active.height > bounds.height) list.scrollTop += active.top - bounds.top;
    else if (active.top < bounds.top) list.scrollTop -= bounds.top - active.top;
    else if (active.bottom > bounds.bottom) list.scrollTop += active.bottom - bounds.bottom;
  }, [activeIndex, result]);

  function select(entry: RepositoryDirectory) {
    onChange(entry.path);
    close();
    focusInput();
  }

  function activate(entry: RepositoryDirectory) {
    if (lookup?.mode === "browse") { request(entry.path, "browse"); focusInput(); }
    else select(entry);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (open && entries.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) => (index + delta + entries.length) % entries.length);
        return;
      }
      if ((event.key === "Enter" || (event.key === "Tab" && lookup?.mode === "complete")) && activeIndex >= 0) {
        if (event.key === "Enter") event.preventDefault();
        activate(entries[activeIndex]!);
        return;
      }
    }
    if (event.key === "Enter" && onSubmit) { event.preventDefault(); close(); onSubmit(); }
    if (!open && event.key === "ArrowDown") { event.preventDefault(); request(value, "complete"); }
  }

  return (
    <div className={`repository-path-picker ${className}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) { event.preventDefault(); close(); focusInput(); }
      }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
      <div className="repository-path-picker__label-row">
        <label htmlFor={id}>Folders on the server</label>
        <button type="button" className="repository-path-picker__browse" disabled={disabled}
          onClick={() => request(value, "browse")} aria-expanded={open} aria-controls={`${id}-panel`}>
          <FolderOpen size={15} aria-hidden="true" /> Browse
        </button>
      </div>
      <p id={`${id}-help`} className="repository-path-picker__help">Paths are on the machine running Swarmcrews, not this browser’s device. Use ~ for the server user’s home folder.</p>
      <input ref={inputRef} id={id} type="text" value={value} placeholder={placeholder} disabled={disabled}
        autoFocus={autoFocus} autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false}
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-describedby={`${id}-help`}
        aria-controls={open && result && !loading && !error ? `${id}-list` : undefined}
        aria-activedescendant={open && entries[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
        onFocus={() => { if (!suppressFocus.current && !lookup) request(value, "complete", 200); }}
        onChange={(event) => { onChange(event.currentTarget.value); request(event.currentTarget.value, "complete", 200); }}
        onKeyDown={onKeyDown} />
      {!open && value.trim() && <div className="repository-path-picker__selection">
        <span>Repository path</span><span className="repository-path-picker__value">{value}</span>
      </div>}
      {open && (
        <div id={`${id}-panel`} className="repository-path-picker__panel" role="region" aria-label="Server folder suggestions">
          <div className="repository-path-picker__toolbar">
            <strong>{lookup.mode === "browse" ? "Browse folders" : "Matching folders"}</strong>
            <div>
              <button type="button" onClick={() => request("", "browse")}><MapPin size={14} aria-hidden="true" /> Browse locations</button>
              <button type="button" aria-label="Close folder picker" onClick={() => { close(); focusInput(); }}><X size={16} aria-hidden="true" /></button>
            </div>
          </div>
          {loading && <div className="repository-path-picker__state" role="status">Loading folders…</div>}
          {error && (isUntrustedRequest ? (
            <div className="repository-path-picker__state repository-path-picker__state--info" role="status">
              Folder browsing was blocked for this address. Open Swarmcrews through localhost or the server’s Tailscale address. You can still type or paste a repository path.
            </div>
          ) : (
            <div className="repository-path-picker__state repository-path-picker__state--error" role="alert">
              <p>{folderErrorMessage(error)} You can still type or paste a path.</p>
              <button type="button" onClick={() => request(lookup.path, lookup.mode)}>Retry folders</button>
            </div>
          ))}
          {!loading && !error && result && (
            <>
              {result.roots.length > 0 && !result.directory && (
                <div className="repository-path-picker__roots" aria-label="Server roots">
                  {result.roots.map((root) => <button key={root.path} type="button" title={root.path} onClick={() => request(root.path, "browse")}>{root.path}</button>)}
                </div>
              )}
              {result.breadcrumbs.length > 0 && (
                <nav className="repository-path-picker__crumbs" aria-label="Folder breadcrumbs">
                  {result.breadcrumbs.map((crumb) => <button key={crumb.path} type="button" title={crumb.path} onClick={() => request(crumb.path, "browse")}>{crumb.name}</button>)}
                </nav>
              )}
              {result.directory && <div className="repository-path-picker__directory">
                <div><span>Current folder</span><span className="repository-path-picker__directory-path">{result.directory}</span></div>
                <button type="button" className="repository-path-picker__use" onClick={() => select({ name: result.directory!, path: result.directory! })}><Check size={15} aria-hidden="true" /> Use this folder</button>
              </div>}
              <div className="repository-path-picker__list-heading">
                <span>{entries.length} {entries.length === 1 ? "folder" : "folders"}{result.truncated ? " shown" : ""}</span>
                {result.parent && <button type="button" className="repository-path-picker__parent" onClick={() => request(result.parent!, "browse")}><ArrowUp size={14} aria-hidden="true" /> Up one folder</button>}
              </div>
              <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label="Folders" className="repository-path-picker__entries">
                {entries.map((entry, index) => (
                  <li key={entry.path} role="option" id={`${id}-option-${index}`} aria-selected={index === activeIndex}
                    tabIndex={0} onClick={() => activate(entry)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(entry); } }}>
                    <Folder className="repository-path-picker__folder-icon" size={18} aria-hidden="true" />
                    <div className="repository-path-picker__entry-copy"><span>{entry.name}</span><small>{entry.path}</small></div>
                    {lookup.mode === "browse" ? <ChevronRight size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
                  </li>
                ))}
              </ul>
              {entries.length === 0 && <div className="repository-path-picker__state">{!result.roots.length
                ? "No browsing locations are available. Check SWARMCREWS_BROWSE_ROOTS and folder permissions on the server. You can still type or paste a path."
                : !result.directory ? "Choose a browsing location." : "No matching folders."}</div>}
              {result.truncated && <div className="repository-path-picker__state">More folders are available; type more to narrow the list.</div>}
              {entries.length > 0 && <div className="repository-path-picker__keyboard-help">
                <span>↑ ↓ to navigate</span><span>{lookup.mode === "browse" ? "Enter to explore · Esc to close" : "Enter to select · Esc to close"}</span>
              </div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
