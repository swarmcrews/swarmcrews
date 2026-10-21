import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowUp, Check, ChevronRight, Folder, FolderOpen, Home, MapPin, Search, Star } from "lucide-react";
import { getRepositoryPathSuggestions } from "../api.ts";
import type { RepositoryDirectory, RepositoryPathSuggestions } from "../../shared/repository-paths.ts";
import "./repository-path-picker.css";

interface RepositoryPathPickerProps {
  value: string;
  onChange: (value: string) => void;
  onEditingChange?: (editing: boolean) => void;
  onNewFolder?: () => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

type Lookup = { path: string; query: string; delay: number };
const unavailableFolder = "Folder is unavailable or outside configured browse roots";
const starredFoldersKey = "swarmcrews:starred-project-folders";

function readStarredFolders(): string[] {
  try {
    const paths: unknown = JSON.parse(localStorage.getItem(starredFoldersKey) || "[]");
    return Array.isArray(paths)
      ? [...new Set(paths.filter((path): path is string => typeof path === "string" && !!path.trim() && path.length <= 32768))]
      : [];
  } catch { return []; }
}

function folderErrorMessage(error: string): string {
  const apiError = /^API error \d+: ([\s\S]*)$/.exec(error);
  if (!apiError) return error;
  try {
    const body: unknown = JSON.parse(apiError[1]!);
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      if (body.error === unavailableFolder) {
        return "This folder cannot be browsed. Choose Home or Locations, or enter its path directly.";
      }
      if (/Untrusted origin or host|Forbidden/.test(body.error)) {
        return "Folder browsing is unavailable at this address. Open Swarmcrews through localhost or the server’s Tailscale address, or enter a path directly.";
      }
      return body.error;
    }
  } catch { /* A proxy may return HTML rather than JSON. */ }
  return "Could not load folders from the server. Try again or enter a path directly.";
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

/** Stars save browsing shortcuts. Only explicit confirmation changes value. */
export function RepositoryPathPicker({
  value, onChange, onEditingChange, onNewFolder, disabled = false,
  placeholder = "Type or paste the full folder path", autoFocus = false, defaultOpen = true, className = "",
}: RepositoryPathPickerProps) {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const pathRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const locationsRef = useRef<HTMLButtonElement>(null);
  const locationsPanelRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const interacted = useRef(false);
  const [starredFolders, setStarredFolders] = useState(readStarredFolders);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [preferenceNotice, setPreferenceNotice] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [editor, setEditor] = useState<"browse" | "manual" | null>(!value.trim() && defaultOpen ? "browse" : null);
  const [draft, setDraft] = useState(value);
  const [lookup, setLookup] = useState<Lookup>({ path: "~", query: "", delay: 0 });
  const [loading, setLoading] = useState(!value.trim() && defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RepositoryPathSuggestions | null>(null);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const entries = !loading && !error && result
    ? result.directory ? result.entries
      : (result.entries.length ? result.entries : result.roots)
        .filter(entry => (entry.path === homePath ? "Home" : entry.name).toLocaleLowerCase().includes(lookup.query.trim().toLocaleLowerCase()))
    : [];
  const currentName = result?.directory
    ? result.directory === homePath ? "Home" : result.breadcrumbs.at(-1)?.name || folderName(result.directory)
    : "Locations";
  const breadcrumbs = result?.breadcrumbs.length ? result.breadcrumbs
    : result?.directory ? [{ name: currentName, path: result.directory }] : [];
  const newDirectory = !loading && !error && !entries.length && result?.directory && lookup.query.trim()
    ? result.newDirectory : undefined;

  function invalidate() {
    requestId.current++;
    controller.current?.abort();
  }

  function request(path: string, query = "", delay = 0) {
    if (disabled) return;
    setLocationsOpen(false);
    invalidate();
    setLoading(true);
    setError(null);
    setActiveIndex(0);
    setLookup({ path, query, delay });
  }

  function close() {
    setLocationsOpen(false);
    invalidate();
    interacted.current = true;
    setEditor(null);
    setLoading(false);
  }

  function confirm(path: string) {
    if (disabled || !path.trim()) return;
    onChange(path.trim());
    close();
  }

  function selectNewDirectory() {
    if (disabled || !newDirectory) return;
    onNewFolder?.();
    confirm(newDirectory.path);
  }

  function browse() {
    interacted.current = true;
    setEditor("browse");
    setResult(null);
    request(result?.newDirectory?.path === value && result.directory ? result.directory : value || "~");
  }

  function manual() {
    setLocationsOpen(false);
    invalidate();
    interacted.current = true;
    setDraft(value);
    setEditor("manual");
    setLoading(false);
  }

  function explore(entry: RepositoryDirectory) {
    request(entry.path);
    searchRef.current?.focus({ preventScroll: true });
  }

  function toggleStar(path: string) {
    if (disabled) return;
    const removing = starredFolders.includes(path);
    const next = removing ? starredFolders.filter(saved => saved !== path) : [...starredFolders, path];
    try {
      if (next.length) localStorage.setItem(starredFoldersKey, JSON.stringify(next));
      else localStorage.removeItem(starredFoldersKey);
      setStarredFolders(next);
      if (removing && locationsOpen) locationsRef.current?.focus({ preventScroll: true });
      setPreferenceError(null);
      setPreferenceNotice(removing ? `Removed ${folderName(path)} from Locations.` : `Saved ${folderName(path)} to Locations in this browser.`);
    } catch {
      setPreferenceError("Could not save starred folders. Browser storage may be unavailable. Try again.");
    }
  }

  useEffect(() => {
    if (!locationsOpen) return;
    locationsPanelRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !locationsPanelRef.current?.contains(event.target) && !locationsRef.current?.contains(event.target)) {
        setLocationsOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [locationsOpen]);

  useEffect(() => {
    // Project availability arrives asynchronously. Auto-open only before the
    // user has interacted, so a refresh or cancellation cannot reopen it.
    if (defaultOpen && editor === null && !value.trim() && !interacted.current) {
      setEditor("browse");
      setLoading(true);
    }
  }, [defaultOpen, editor, value]);

  useEffect(() => { onEditingChange?.(editor !== null); }, [editor, onEditingChange]);

  useEffect(() => {
    if (!autoFocus && !interacted.current) return;
    const target = editor === "browse" ? searchRef.current : editor === "manual" ? pathRef.current : chooseRef.current;
    target?.focus({ preventScroll: true });
  }, [editor, autoFocus]);

  useEffect(() => {
    if (editor !== "browse" || disabled) return;
    const current = ++requestId.current;
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(() => {
      const load = async () => {
        try {
          return await getRepositoryPathSuggestions({ path: lookup.path, mode: "browse", query: lookup.query }, abort.signal);
        } catch (reason) {
          // A configured root can exclude Home. Fall back only for a scope
          // failure, never for rejected origins, network failures or timeouts.
          if (!abort.signal.aborted && lookup.path === "~" && reason instanceof Error && reason.message.includes(unavailableFolder)) {
            return await getRepositoryPathSuggestions({ path: "", mode: "browse", query: lookup.query }, abort.signal);
          }
          throw reason;
        }
      };
      void load().then(next => {
        if (abort.signal.aborted || current !== requestId.current) return;
        if (!next || !Array.isArray(next.entries) || !Array.isArray(next.roots) || !Array.isArray(next.breadcrumbs)
          || !(next.directory === null || typeof next.directory === "string")
          || !(next.parent === null || typeof next.parent === "string")
          || (next.newDirectory !== undefined && (!next.newDirectory || typeof next.newDirectory.name !== "string" || typeof next.newDirectory.path !== "string"))
          || ![...next.entries, ...next.roots, ...next.breadcrumbs].every(entry => entry && typeof entry.name === "string" && typeof entry.path === "string")) {
          throw new Error("Could not load folders from the server. Try again or enter a path directly.");
        }
        setResult(next);
        if (lookup.path === "~" && next.directory) setHomePath(next.directory);
      }).catch((reason: unknown) => {
        if (abort.signal.aborted || current !== requestId.current) return;
        setError(folderErrorMessage(reason instanceof Error ? reason.message : "Could not load folders"));
      }).finally(() => {
        if (!abort.signal.aborted && current === requestId.current) setLoading(false);
      });
    }, lookup.delay);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [editor, lookup, disabled]);

  useEffect(() => {
    const list = listRef.current;
    const row = list?.children[activeIndex];
    if (!list || !row) return;
    const bounds = list.getBoundingClientRect();
    const active = row.getBoundingClientRect();
    if (active.height > bounds.height) list.scrollTop += active.top - bounds.top;
    else if (active.top < bounds.top) list.scrollTop -= bounds.top - active.top;
    else if (active.bottom > bounds.bottom) list.scrollTop += active.bottom - bounds.bottom;
  }, [activeIndex, result, loading]);

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      if (!loading && !error && result?.parent) request(result.parent);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (loading || error) return;
      if (event.ctrlKey && newDirectory) selectNewDirectory();
      else if (event.ctrlKey && result?.directory) confirm(result.directory);
      else if (!event.shiftKey && entries[activeIndex]) explore(entries[activeIndex]);
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && entries.length) {
      event.preventDefault();
      setActiveIndex(index => (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length);
    }
  }

  return (
    <div className={`repository-path-picker ${className}`} onKeyDown={event => {
      if (event.key === "Escape" && locationsOpen) {
        event.preventDefault(); event.stopPropagation(); setLocationsOpen(false); locationsRef.current?.focus({ preventScroll: true }); return;
      }
      if (event.key === "Escape" && editor) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <div className="repository-path-picker__label-row">
        <span className="repository-path-picker__label">Project folder</span>
      </div>
      <p id={`${id}-help`} className="repository-path-picker__help">Choose a folder on the machine running Swarmcrews. Browsing does not change your files.</p>
      {preferenceNotice && <p className="repository-path-picker__help" role="status">{preferenceNotice}</p>}
      {preferenceError && <p className="repository-path-picker__state--error repository-path-picker__help" role="alert">{preferenceError}</p>}
      {value.trim() && <div className="repository-path-picker__selection">
        <strong>{value === homePath ? "Home" : folderName(value)}</strong><span className="repository-path-picker__value">{value}</span>
        {starredFolders.includes(value) && <span className="repository-path-picker__saved"><Star size={14} aria-hidden="true" fill="currentColor" /> Starred location</span>}
        {result?.newDirectory?.path === value && <span className="repository-path-picker__help">New folder — created when you create the project.</span>}
      </div>}
      {!editor && <div className="repository-path-picker__actions repository-path-picker__entry-actions">
        <button type="button" className="repository-path-picker__manual-toggle" disabled={disabled} onClick={manual}>
          Enter a path instead
        </button>
        <button ref={chooseRef} type="button" disabled={disabled} className="repository-path-picker__browse" onClick={browse}>
          <FolderOpen size={15} aria-hidden="true" /> {value.trim() ? "Change folder" : "Choose folder"}
        </button>
      </div>}
      {!editor && !value.trim() && <p className="repository-path-picker__help">Choose a project folder to continue.</p>}
      {editor === "browse" && <div className="repository-path-picker__panel" role="region" aria-label="Choose a project folder">
        <div className="repository-path-picker__toolbar">
          <div>
            <button type="button" disabled={disabled} onClick={() => request("~")}><Home size={15} aria-hidden="true" /> Home</button>
            <button ref={locationsRef} type="button" disabled={disabled} aria-expanded={locationsOpen} aria-controls={locationsOpen ? `${id}-locations` : undefined}
              onClick={() => setLocationsOpen(open => !open)}><MapPin size={15} aria-hidden="true" /> Locations</button>
            <button type="button" disabled={disabled || loading || !!error || !result?.parent}
              onClick={() => request(result!.parent!)} title="Alt + ↑"><ArrowUp size={15} aria-hidden="true" /> Up one folder</button>
          </div>
        </div>
        {locationsOpen && <div ref={locationsPanelRef} id={`${id}-locations`} className="repository-path-picker__locations" role="region" aria-label="Folder locations">
          <button type="button" disabled={disabled} onClick={() => { request("~"); searchRef.current?.focus({ preventScroll: true }); }}><Home size={16} aria-hidden="true" /> Home</button>
          <span className="repository-path-picker__label">Starred folders</span>
          {!starredFolders.length && <p className="repository-path-picker__help">Star a folder beside the breadcrumbs to save it here.</p>}
          {starredFolders.map(path => <div className="repository-path-picker__location" key={path}>
            <button type="button" disabled={disabled} aria-label={`Open starred folder ${path}`} title={path} onClick={() => explore({ name: folderName(path), path })}>
              <Star size={16} aria-hidden="true" fill="currentColor" /><span><strong>{path === homePath ? "Home" : folderName(path)}</strong><span>{path}</span></span>
            </button>
            <button type="button" disabled={disabled} aria-label={`Unstar folder ${path}`} title="Remove from Locations" onClick={() => toggleStar(path)}><Star size={16} aria-hidden="true" fill="currentColor" /></button>
          </div>)}
          <button type="button" disabled={disabled} onClick={() => { request(""); searchRef.current?.focus({ preventScroll: true }); }}><MapPin size={16} aria-hidden="true" /> Browse configured locations</button>
        </div>}
        {result && breadcrumbs.length ? <div className="repository-path-picker__breadcrumb-bar"><nav className="repository-path-picker__crumbs" aria-label="Folder breadcrumbs">
          {breadcrumbs.map(crumb => <button key={crumb.path} type="button" disabled={disabled || loading}
            title={crumb.path} aria-current={crumb.path === result.directory ? "location" : undefined}
            onClick={() => request(crumb.path)}>{crumb.path === homePath ? "Home" : crumb.name}</button>)}
        </nav>
          {result.directory && <div className="repository-path-picker__actions repository-path-picker__breadcrumb-actions">
            <button type="button" className="repository-path-picker__star" disabled={disabled || loading || !!error}
              aria-pressed={starredFolders.includes(result.directory)} aria-label={`${starredFolders.includes(result.directory) ? "Unstar" : "Star"} folder ${currentName}`}
              title="Save or remove this folder in Locations" onClick={() => toggleStar(result.directory!)}>
              <Star size={16} aria-hidden="true" fill={starredFolders.includes(result.directory) ? "currentColor" : "none"} />
              {starredFolders.includes(result.directory) ? "Starred" : "Star folder"}
            </button>
            <button type="button" className="repository-path-picker__use"
              disabled={disabled || loading || !!error} aria-label={`Use folder ${currentName}`} onClick={() => confirm(result.directory!)}>
              <Check size={15} aria-hidden="true" /> Use “{currentName}”
            </button>
          </div>}
        </div> : null}
        <div className="repository-path-picker__search">
          <label htmlFor={`${id}-search`}>Search folders</label>
          <div><Search size={16} aria-hidden="true" /><input ref={searchRef} id={`${id}-search`} disabled={disabled}
            value={lookup.query} maxLength={256} placeholder="Filter folder names here…" role="combobox"
            aria-autocomplete="list" aria-expanded={!loading && !error} aria-controls={!loading && !error ? `${id}-list` : undefined}
            aria-activedescendant={entries[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
            aria-describedby={`${id}-help ${id}-keys`} autoComplete="off" autoCapitalize="off" spellCheck={false}
            onChange={event => request(lookup.path, event.currentTarget.value, 150)} onKeyDown={onSearchKeyDown} /></div>
        </div>
        {loading && <div className="repository-path-picker__state" role="status">Loading folders…</div>}
        {error && <div className="repository-path-picker__state repository-path-picker__state--error" role="alert">
          <p>{error}</p><button type="button" disabled={disabled} onClick={() => request(lookup.path, lookup.query)}>Retry folders</button>
        </div>}
        {!loading && !error && <>
          <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label="Folders" className="repository-path-picker__entries">
            {entries.map((entry, index) => <li key={entry.path} role="option" id={`${id}-option-${index}`}
              aria-selected={index === activeIndex} tabIndex={-1} onMouseDown={event => event.preventDefault()}
              onClick={() => { if (!disabled) explore(entry); }} onKeyDown={event => {
                if ((event.key === "Enter" || event.key === " ") && !disabled) { event.preventDefault(); explore(entry); }
              }}>
              <Folder size={19} aria-hidden="true" /><span>{entry.path === homePath ? "Home" : entry.name}</span><ChevronRight size={16} aria-hidden="true" />
            </li>)}
          </ul>
          {result && !entries.length && <div className="repository-path-picker__state" role="status">{!result.roots.length && !result.directory
            ? "No browsing locations are available. You can enter a path directly."
            : lookup.query ? newDirectory ? "No folders match this search. You can use this name for a new folder." : "No folders match this search. Try a different name."
              : result.directory ? "No folders inside this folder. You can use it as your project folder." : "Choose a location to start browsing."}
            {newDirectory && <div className="repository-path-picker__new-directory">
              <span className="repository-path-picker__directory-path">{newDirectory.path}</span>
              <p className="repository-path-picker__help">Use this destination, then create the project to create the folder and choose Git setup.</p>
              <button type="button" className="repository-path-picker__use" disabled={disabled} aria-label={`Use new folder ${newDirectory.name}`} onClick={selectNewDirectory}>
                <FolderOpen size={15} aria-hidden="true" /> Use new folder “{newDirectory.name}”
              </button>
              <span className="repository-path-picker__help">Ctrl + Enter to use this destination</span>
            </div>}
          </div>}
          {result?.truncated && <div className="repository-path-picker__state">More folders are available. Search by name to narrow this folder’s contents.</div>}
        </>}
        <div id={`${id}-keys`} className="repository-path-picker__keyboard-help">↑ ↓ to navigate · Enter to open · Alt + ↑ to go up · Esc to cancel</div>
        <div className="repository-path-picker__footer">
          <div className="repository-path-picker__directory">
            <span>{result?.directory ? "Current folder" : "Browsing locations"}</span>
            <strong>{currentName}</strong>
            {result?.directory && <span className="repository-path-picker__directory-path">{result.directory}</span>}
          </div>
          <div className="repository-path-picker__actions">
            <button type="button" disabled={disabled} onClick={close}>Cancel</button>
          </div>
        </div>
      </div>}
      {editor === "manual" && <div className="repository-path-picker__manual" id={`${id}-manual`}>
        <label htmlFor={`${id}-path`}>Repository path</label>
        <p className="repository-path-picker__help">Type or paste a full server path. Use ~ for the server user’s Home folder. A new folder can be created when you register the project.</p>
        <input ref={pathRef} id={`${id}-path`} value={draft} disabled={disabled} placeholder={placeholder}
          autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={event => setDraft(event.currentTarget.value)} onKeyDown={event => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); confirm(draft); }
          }} />
        <div className="repository-path-picker__actions">
          <button type="button" className="repository-path-picker__use" disabled={disabled || !draft.trim()} onClick={() => confirm(draft)}>Use this path</button>
          <button type="button" disabled={disabled} onClick={browse}>Browse folders instead</button>
          <button type="button" disabled={disabled} onClick={close}>Cancel</button>
        </div>
      </div>}
    </div>
  );
}
