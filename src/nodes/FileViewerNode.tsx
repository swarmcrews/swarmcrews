import { useState, useEffect, useLayoutEffect, useId, useRef, useCallback } from "react";
import "./file-viewer.css";
import type { NodeRenderProps } from "../types.ts";
import { registerNodeType } from "../node-registry.ts";
import { registerContract, CONTEXT_OUT_PORT } from "../graph.ts";
import type { NodeInterfaceContract } from "../graph.ts";
import { ResizeHandle } from "../components/ResizeHandle.tsx";
import { MarkdownPreview } from "../components/MarkdownPreview.tsx";
import { copyText } from "../components/CopyButton.tsx";
import { getAuthToken } from "../api.ts";
import { browserLogger } from "../logging.ts";

const log = browserLogger.child("file-viewer-node");

// ── Graph contract ─────────────────────────────────────

const FILE_VIEWER_CONTRACT: NodeInterfaceContract = {
  nodeType: "file-viewer",
  label: "File Viewer",
  description:
    "Renders a project file read-only. Markdown is rendered; code shows with line numbers.",
  ports: [CONTEXT_OUT_PORT],
};

registerContract(FILE_VIEWER_CONTRACT);

// ── Types ──────────────────────────────────────────────

export interface FileViewerData {
  /** Relative file path from project root */
  filePath: string;
  /** Cached file content for context system (set after fetch) */
  loadedContent?: string;
  /** Whether the viewer is collapsed (default: true) */
  collapsed?: boolean;
  /** Remembered expanded height so we can restore on un-collapse */
  expandedHeight?: number;
}

// ── Helpers ────────────────────────────────────────────

const BG = "var(--bg-surface)";
const BORDER = "var(--border-default)";
const HEADER_BG = "var(--state-hover)";
/** Height of the node when collapsed — just the single header row */
const COLLAPSED_HEIGHT = 38;
const DEFAULT_EXPANDED_HEIGHT = 420;

function encodePath(p: string): string {
  return btoa(
    Array.from(new TextEncoder().encode(p), (b) =>
      String.fromCodePoint(b),
    ).join(""),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MARKDOWN_EXTS = new Set(["md", "mdx"]);

// ── Line-numbered code view ───────────────────────────

function CodeView({ content }: { content: string }) {
  const lines = content.split("\n");
  const pad = String(lines.length).length;

  return (
    <div
      style={{
        padding: "10px 0",
        fontSize: ".8125rem",
        fontFamily: "var(--font-mono)",
        lineHeight: 1.6,
        tabSize: 2,
      }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            minHeight: "1.6em",
            padding: "0 12px",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: `${pad + 1}ch`,
              textAlign: "right",
              color: "var(--text-muted)",
              userSelect: "none",
              flexShrink: 0,
              paddingRight: "1.5ch",
            }}
          >
            {i + 1}
          </span>
          <span data-file-line={i}
            style={{
              flex: 1,
              whiteSpace: "pre",
              overflowX: "auto",
              color: "var(--text-primary)",
            }}
          >
            {line || " "}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────

function FileViewerNodeRenderer({
  node,
  projectPath,
  onResize,
  onResizeStart,
  onResizeEnd,
  onUpdateData,
}: NodeRenderProps) {
  const data = node.data as FileViewerData;
  const collapsed = data.collapsed !== false; // default true
  const [content, setContent] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const readPending = useRef(false);
  const retryRequested = useRef<string | null>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const restoreReadFocus = useRef(false);
  const encoded = projectPath ? encodePath(projectPath) : null;
  const readIdentity = `${encoded ?? ""}\n${data.filePath}`;
  const identityRef = useRef(readIdentity);
  identityRef.current = readIdentity;
  const ext = extOf(data.filePath);
  const isMarkdown = MARKDOWN_EXTS.has(ext);
  const fileName = data.filePath ? data.filePath.split("/").pop() ?? data.filePath : "";
  const lineCount = content ? content.split("\n").length : 0;

  // Track pointer start position so we can distinguish a click (expand/collapse)
  // from a drag (move the node). Without this, onMouseDown stopPropagation on
  // the collapsed header would prevent CanvasNode from ever initiating a drag.
  const clickStartRef = useRef<{ x: number; y: number } | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const dataRef = useRef(data);
  dataRef.current = data;
  const scrollPosition = useRef({ top: 0, left: 0 });
  const lineScroll = useRef<number[]>([]);
  const scrollPath = useRef(data.filePath);
  const restoreToggleFocus = useRef(false);
  useLayoutEffect(() => {
    if (scrollPath.current !== data.filePath) {
      scrollPath.current = data.filePath;
      scrollPosition.current = { top: 0, left: 0 };
      lineScroll.current = [];
    }
    if (!collapsed && contentRef.current) {
      contentRef.current.scrollTop = scrollPosition.current.top;
      contentRef.current.scrollLeft = scrollPosition.current.left;
      contentRef.current.querySelectorAll<HTMLElement>("[data-file-line]").forEach((line, index) => {
        line.scrollLeft = lineScroll.current[index] ?? 0;
      });
    }
    if (restoreToggleFocus.current) {
      restoreToggleFocus.current = false;
      toggleRef.current?.focus({ preventScroll: true });
    }
  }, [collapsed, data.filePath]);

  useLayoutEffect(() => {
    if (loading || !restoreReadFocus.current) return;
    restoreReadFocus.current = false;
    if (!error) contentRef.current?.focus({ preventScroll: true });
  }, [loading, error, content]);

  const retryRead = () => {
    if (!error || readPending.current) return;
    readPending.current = true; // Guard repeated activation before React commits.
    retryRequested.current = readIdentity;
    setLoading(true);
    setRetryCount(count => count + 1);
  };

  const handleCopy = useCallback(() => {
    if (!content) return;
    copyText(content)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch((err: unknown) => {
        log.warn("copy_failed", { error: err });
      });
  }, [content]);

  const toggleCollapsed = () => {
    restoreToggleFocus.current = document.activeElement === toggleRef.current;
    if (!collapsed && contentRef.current) {
      scrollPosition.current = { top: contentRef.current.scrollTop, left: contentRef.current.scrollLeft };
      lineScroll.current = [...contentRef.current.querySelectorAll<HTMLElement>("[data-file-line]")].map(line => line.scrollLeft);
    }
    if (collapsed) {
      // Expanding — restore saved height
      const h = data.expandedHeight ?? DEFAULT_EXPANDED_HEIGHT;
      onUpdateData({ ...data, collapsed: false });
      onResize?.({ width: node.size.width, height: h });
    } else {
      // Collapsing — save current height, shrink node
      onUpdateData({ ...data, collapsed: true, expandedHeight: node.size.height });
      onResize?.({ width: node.size.width, height: COLLAPSED_HEIGHT });
    }
  };

  const toggle = <button ref={toggleRef} type="button" className="file-viewer-toggle" data-no-drag
    aria-label={collapsed ? "Expand file viewer" : "Collapse file viewer"}
    aria-expanded={!collapsed} aria-controls={collapsed ? undefined : contentId}
    onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
    onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
    onClick={event => { event.stopPropagation(); toggleCollapsed(); }}>
    <span aria-hidden="true">{collapsed ? "▶" : "▼"}</span>
  </button>;

  // Fetch only on identity changes or explicit recovery, never on toggling.
  useEffect(() => {
    if (!encoded || !data.filePath) {
      readPending.current = false;
      retryRequested.current = null;
      setContent(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const isRetry = retryRequested.current === readIdentity;
    retryRequested.current = null;
    readPending.current = true;
    setLoading(true);
    // Keep the failed read and its focused recovery control while retrying.
    if (!isRetry) setError(null);

    getAuthToken()
      .then((token) =>
        fetch(
          `/api/projects/${encoded}/file?path=${encodeURIComponent(data.filePath)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      )
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<{
          content: string;
          size: number;
          truncated: boolean;
        }>;
      })
      .then((json) => {
        if (cancelled || identityRef.current !== readIdentity) return;
        restoreReadFocus.current = isRetry && document.activeElement === retryRef.current;
        setError(null);
        setContent(json.content);
        setFileSize(json.size);
        setTruncated(json.truncated);
        // Persist to node data so the context system can read it
        onUpdateData({ ...dataRef.current, loadedContent: json.content });
      })
      .catch((err) => {
        if (cancelled || identityRef.current !== readIdentity) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setContent(null);
      })
      .finally(() => {
        if (!cancelled && identityRef.current === readIdentity) {
          readPending.current = false;
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [encoded, data.filePath, retryCount]);

  // ── Collapsed view ────────────────────────────────────
  if (collapsed) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          borderRadius: 8,
          border: `1px solid ${BORDER}`,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          onPointerDown={(e) => {
            clickStartRef.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerCancel={() => { clickStartRef.current = null; }}
          onPointerUp={(e) => {
            if (clickStartRef.current) {
              const d =
                Math.abs(e.clientX - clickStartRef.current.x) +
                Math.abs(e.clientY - clickStartRef.current.y);
              clickStartRef.current = null;
              if (d < 5) toggleCollapsed();
            }
          }}
          style={{
            padding: "4px 8px",
            lineHeight: 1.1,
            display: "flex",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
            background: HEADER_BG,
            flexShrink: 0,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--state-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = HEADER_BG; }}
        >
          {toggle}
          <span
            style={{
              fontSize: "0.75rem",
              fontFamily: "var(--font-mono)",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
            title={data.filePath}
          >
            {fileName || "No file selected"}
          </span>
          {content !== null && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                flexShrink: 0,
              }}
            >
              {lineCount}L {formatSize(fileSize)}
            </span>
          )}
          {loading && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
              ...
            </span>
          )}
          {error && (
            <span style={{ fontSize: "0.75rem", color: "var(--danger-color)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
              error
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Expanded view ─────────────────────────────────────
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: BG,
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          alignItems: "center",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
          background: HEADER_BG,
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 12rem", minWidth: 0 }}>
          {toggle}
          <span className="file-viewer-kind"
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: 1,
              fontFamily: "var(--font-mono)",
              flexShrink: 1,
              minWidth: 0,
              overflowWrap: "normal",
            }}
          >
            File Viewer
            <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--accent)" }}>
              {" "}&middot; Context
            </span>
          </span>
        </div>
        {content !== null && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, maxWidth: "100%" }}>
            <button
              onClick={handleCopy}
              onMouseDown={(e) => e.stopPropagation()}
              title="Copy file contents"
              style={{
                background: copied ? "var(--accent)" : "transparent",
                border: `1px solid ${copied ? "var(--accent)" : "var(--border-default)"}`,
                borderRadius: 4,
                padding: "2px 8px",
                cursor: "pointer",
                fontSize: "0.75rem",
                fontFamily: "var(--font-mono)",
                color: copied ? "var(--text-on-accent)" : "var(--text-muted)",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {formatSize(fileSize)}
              {truncated ? " (truncated)" : ""}
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          padding: "6px 12px",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
          color: "var(--text-primary)",
          background: "var(--state-hover)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={data.filePath}
      >
        {data.filePath || "No file selected"}
      </div>

      <div ref={contentRef} id={contentId} role="region" aria-label="File contents" tabIndex={-1} aria-busy={loading}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}
      >
        {error ? (
          <StatusMsg
            style={{
              color: "var(--danger-color)",
              background: "var(--danger-bg)",
            }}
          >
            <p className="file-viewer-error" role="alert">{error}</p>
            {/* Native disabled drops keyboard focus in Chromium; aria-disabled
                keeps the recovery anchor while retryRead guards every activation. */}
            <button ref={retryRef} type="button" className="file-viewer-retry" data-no-drag
              aria-label="Retry file" aria-disabled={loading}
              onPointerDown={event => event.stopPropagation()}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
              onClick={event => { event.stopPropagation(); retryRead(); }}>
              {loading ? "Retrying..." : "Retry"}
            </button>
          </StatusMsg>
        ) : loading ? (
          <StatusMsg>Loading...</StatusMsg>
        ) : content === null ? (
          <StatusMsg>No file selected</StatusMsg>
        ) : isMarkdown ? (
          <div
            style={{
              padding: "12px 16px",
              color: "var(--text-primary)",
              fontSize: ".875rem",
              fontFamily: "var(--font-sans)",
              lineHeight: 1.6,
            }}
          >
            <MarkdownPreview
              content={content}
              className="md-preview file-viewer-markdown"
            />
          </div>
        ) : (
          <CodeView content={content} />
        )}
      </div>

      {onResize && (
        <ResizeHandle
          currentSize={node.size}
          minWidth={280}
          minHeight={200}
          onResize={onResize}
          {...(onResizeStart ? { onResizeStart } : {})}
          {...(onResizeEnd ? { onResizeEnd } : {})}
        />
      )}
    </div>
  );
}

function StatusMsg({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        padding: 20,
        textAlign: "center",
        color: "var(--text-muted)",
        fontSize: "0.75rem",
        fontFamily: "var(--font-mono)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Registration ──────────────────────────────────────

registerNodeType({
  type: "file-viewer",
  label: "File Viewer",
  defaultSize: { width: 480, height: COLLAPSED_HEIGHT },
  render: FileViewerNodeRenderer,
  userCreatable: false,
  providesContext: true,
  extractContent: (data) => (data as { loadedContent?: string })?.loadedContent ?? null,
});
