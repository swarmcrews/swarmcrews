import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { Check, Clipboard, File, FileCode2, Image, Maximize2, Minimize2, WrapText } from "lucide-react";
import { getAuthToken } from "./api.ts";
import { copyText } from "./components/CopyButton.tsx";
import { StatusMessage } from "./components/StatusMessage.tsx";
import { FileDocumentPreview } from "./file-view/FileDocumentPreview.tsx";
import { applyTheme } from "./themes.ts";
import { loadPersistedThemeId } from "./use-theme.ts";
import "./file-link-view.css";

type Mode = "preview" | "source";
type CopyFeedback = { action: "path" | "source"; failed: boolean };

function safeLine(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1048576).toFixed(1)} MB`;
}

export default function FileLinkView() {
  // The pre-React bootstrap restores only loading-screen tokens.
  useLayoutEffect(() => applyTheme(loadPersistedThemeId()), []);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const project = params.get("project") ?? "";
  const path = params.get("path") ?? "";
  const image = /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
  const pdf = /\.pdf$/i.test(path);
  const markdown = /\.mdx?$/i.test(path);
  const text = !image && !pdf;
  const initialLine = safeLine(params.get("line"));
  const filename = path.split("/").filter(Boolean).pop() || "File viewer";
  const type = filename.includes(".") ? filename.split(".").pop()?.toUpperCase() : "TEXT";

  const [content, setContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>(() => initialLine || !markdown ? "source" : "preview");
  const [line, setLine] = useState<number | null>(initialLine);
  const [lineInput, setLineInput] = useState(initialLine?.toString() ?? "");
  const [wrap, setWrap] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const lines = useMemo(() => content ? content.split("\n") : [], [content]);
  const loaded = content !== null || blobUrl !== null;
  const requestedLine = safeLine(lineInput);
  const validTarget = requestedLine !== null && requestedLine <= lines.length;
  const unavailableLine = line !== null && content !== null && line > lines.length;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    document.title = filename;
    setContent(null);
    setBlobUrl(null);
    setSize(null);
    setError(null);
    setTruncated(false);
    setCopyFeedback(null);

    async function load() {
      try {
        if (!project || !path) throw new Error("Missing project or file path.");
        const token = await getAuthToken();
        if (controller.signal.aborted) return;
        const response = await fetch(
          `/api/projects/${encodeURIComponent(project)}/${image || pdf ? "blob" : "file"}?path=${encodeURIComponent(path)}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Unable to open file (HTTP ${response.status}).`);
        }
        if (image || pdf) {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(pdf ? new Blob([blob], { type: "application/pdf" }) : blob);
          setSize(blob.size);
          setBlobUrl(objectUrl);
        } else {
          const body = await response.json() as { content?: unknown; truncated?: boolean };
          if (controller.signal.aborted) return;
          if (typeof body.content !== "string") throw new Error("The file response did not contain readable text.");
          setContent(body.content);
          setSize(new TextEncoder().encode(body.content).byteLength);
          setTruncated(Boolean(body.truncated));
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to open file.");
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [project, path, image, pdf, filename, attempt]);

  useEffect(() => {
    if (content === null || mode !== "source" || !line) return;
    const target = document.getElementById(`L${line}`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "center" });
  }, [content, mode, line]);

  useEffect(() => {
    if (!copyFeedback) return;
    const timer = setTimeout(() => setCopyFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  async function copy(value: string, action: CopyFeedback["action"]) {
    try {
      await copyText(value);
      setCopyFeedback({ action, failed: false });
    } catch {
      setCopyFeedback({ action, failed: true });
    }
  }

  function goToLine() {
    if (!validTarget || requestedLine === null) return;
    setLine(requestedLine);
    setMode("source");
    const url = new URL(window.location.href);
    url.searchParams.set("line", String(requestedLine));
    window.history.replaceState(null, "", url);
    // Repeated navigation to the same line must still move focus and scroll.
    const target = document.getElementById(`L${requestedLine}`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "center" });
  }

  const copiedPath = copyFeedback?.action === "path" && !copyFeedback.failed;
  return (
    <main className="file-link-view">
      <header className="file-link-view__header">
        <div className="file-link-view__identity">
          <span className="file-link-view__file-icon" aria-hidden="true">
            {image ? <Image size={19} /> : text ? <FileCode2 size={19} /> : <File size={19} />}
          </span>
          <div className="file-link-view__names">
            <h1>{filename}</h1>
            <p title={path}>{path || "No file path supplied"}</p>
          </div>
          {path && <span className="file-link-view__badge">{type}</span>}
        </div>
        <div className="file-link-view__actions">
          <button className="file-link-view__action" type="button" aria-label="Copy path" title="Copy path" onClick={() => void copy(path, "path")} disabled={!path}>
            {copiedPath ? <Check size={15} aria-hidden="true" /> : <Clipboard size={15} aria-hidden="true" />}
            <span>Copy path</span>
          </button>
          {copyFeedback && <span role="status" className="file-link-view__copy-feedback">
            {copyFeedback.failed ? "Copy failed. Try again." : copyFeedback.action === "path" ? "Path copied" : "Source copied"}
          </span>}
        </div>
      </header>

      {text && (
        <section className="file-link-view__toolbar" aria-label="File controls">
          {markdown && <div className="file-link-view__segmented" role="group" aria-label="View mode">
            <button type="button" className={mode === "preview" ? "is-active" : ""} aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Preview</button>
            <button type="button" className={mode === "source" ? "is-active" : ""} aria-pressed={mode === "source"} onClick={() => setMode("source")}>Source</button>
          </div>}
          <span className="file-link-view__toolbar-spacer" />
          {mode === "source" && <>
            <button className={`file-link-view__tool ${wrap ? "is-active" : ""}`} type="button" aria-pressed={wrap} onClick={() => setWrap(!wrap)} disabled={!loaded}>
              <WrapText size={16} aria-hidden="true" />Wrap
            </button>
            <form className="file-link-view__line-form" onSubmit={event => { event.preventDefault(); goToLine(); }}>
              <label htmlFor="file-line">Go to line</label>
              <input id="file-line" inputMode="numeric" pattern="[0-9]*" value={lineInput} onChange={event => setLineInput(event.target.value)} placeholder="Line" aria-invalid={lineInput !== "" && !validTarget} title={lines.length ? `Enter a line from 1 to ${lines.length}` : "No source lines loaded"} />
              <button type="submit" disabled={!validTarget}>Go</button>
            </form>
          </>}
          <button className="file-link-view__tool" type="button" disabled={content === null} onClick={() => content !== null && void copy(content, "source")}>
            <Clipboard size={16} aria-hidden="true" />Copy source
          </button>
        </section>
      )}

      <section className="file-link-view__content" aria-label="File content">
        {error && <StatusMessage tone="error" onRetry={project && path ? () => setAttempt(value => value + 1) : undefined}>{error}</StatusMessage>}
        {!error && !loaded && <StatusMessage tone="loading">Loading file…</StatusMessage>}
        {truncated && <StatusMessage>This preview is limited to the first 512 KB.</StatusMessage>}
        {unavailableLine && mode === "source" && <StatusMessage>Line {line} is outside this preview. {lines.length} lines are available.</StatusMessage>}

        {!error && blobUrl && image && <div className="file-link-view__media-stage">
          <div className={`file-link-view__image-frame ${actualSize ? "is-actual" : ""}`}>
            <img src={blobUrl} alt={filename} onError={() => setError("This image could not be displayed.")} />
          </div>
          <button className="file-link-view__tool file-link-view__media-toggle" type="button" aria-pressed={actualSize} onClick={() => setActualSize(!actualSize)}>
            {actualSize ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            {actualSize ? "Fit image" : "Actual size"}
          </button>
        </div>}
        {!error && blobUrl && pdf && <div className="file-link-view__pdf-wrap">
          <div className="file-link-view__pdf-heading"><span>PDF preview</span><a href={blobUrl} target="_blank" rel="noreferrer">Open in new tab</a></div>
          <iframe title={`${filename} PDF preview`} src={`${blobUrl}#page=1`} />
        </div>}
        {content === "" && <div className="file-link-view__empty">
          <FileCode2 size={24} aria-hidden="true" /><h2>This file is empty</h2><p>There is no content to preview.</p>
        </div>}
        {content && markdown && mode === "preview" && <div className="file-link-view__document"><FileDocumentPreview content={content} /></div>}
        {content && (!markdown || mode === "source") && <div className={`file-link-view__source ${wrap ? "is-wrapped" : ""}`} role="region" aria-label="Source code" tabIndex={0} style={{ "--file-line-digits": Math.max(3, String(lines.length).length) } as CSSProperties}>
          <pre>{lines.map((value, index) => (
            <div className={`file-link-view__line ${index + 1 === line ? "is-active" : ""}`} key={index + 1} id={`L${index + 1}`} tabIndex={-1}>
              <span className="file-link-view__gutter" aria-hidden="true">{index + 1}</span><code>{value || " "}</code>
            </div>
          ))}</pre>
        </div>}
      </section>
      <footer className="file-link-view__footer">
        <span>{error ? "Not loaded" : loaded ? truncated ? "Partial preview" : "Read only" : "Loading"}</span>
        {loaded && <><span aria-hidden="true">·</span><span>{text ? `${lines.length} ${lines.length === 1 ? "line" : "lines"}` : image ? "Image" : "PDF"}</span></>}
        {size !== null && <><span aria-hidden="true">·</span><span>{formatBytes(size)}</span></>}
        {line && mode === "source" && !unavailableLine && <><span aria-hidden="true">·</span><span>Line {line}</span></>}
      </footer>
    </main>
  );
}
