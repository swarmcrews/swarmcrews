import { memo, useId, useMemo, type CSSProperties } from "react";
import { ArrowUpRight, PanelsTopLeft } from "lucide-react";
import type { CanvasNode } from "./types.ts";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, workspaceCanvasPreview, type PreviewEdge, type WorkspacePreview } from "./workspace-canvas-preview.ts";
import "./workspace-canvas-preview.css";

const EMPTY_EDGES: readonly PreviewEdge[] = [];

// Streaming node data changes often. Only repaint when the small visual projection changes.
const CanvasMap = memo(function CanvasMap({ preview }: { preview: WorkspacePreview }) {
  const descriptionId = useId();
  const statuses = new Map<string, number>();
  for (const node of preview.nodes) if (node.status) {
    statuses.set(node.status.label, (statuses.get(node.status.label) ?? 0) + 1);
  }
  return <svg className="workspace-preview__map" viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
    role="img" aria-describedby={statuses.size ? descriptionId : undefined} aria-label={`${preview.name} workspace layout, ${preview.total} ${preview.total === 1 ? "node" : "nodes"}. Open canvas to explore.`}>
    {statuses.size > 0 && <desc id={descriptionId}>Shown agent statuses: {[...statuses].map(([label, count]) => `${label}: ${count}`).join(". ")}.</desc>}
    {preview.nodes.filter(node => node.kind === "group").map(node => <rect key={node.id}
      className="workspace-preview__group" x={node.x} y={node.y} width={node.width} height={node.height} rx={4} />)}
    <g className="workspace-preview__edges">{preview.edges.map(edge => <path key={edge.id}
      d={`M ${edge.x1} ${edge.y1} C ${(edge.x1 + edge.x2) / 2} ${edge.y1}, ${(edge.x1 + edge.x2) / 2} ${edge.y2}, ${edge.x2} ${edge.y2}`} />)}</g>
    {preview.nodes.filter(node => node.kind !== "group").map(node => {
      const chars = Math.floor((node.width - 20) / 7);
      const label = node.label.length > chars ? `${node.label.slice(0, Math.max(0, chars - 1))}…` : node.label;
      const statusLabel = node.status && (node.status.label.length > chars
        ? `${node.status.label.slice(0, Math.max(0, chars - 1))}…` : node.status.label);
      return <g key={node.id} className={`workspace-preview__node workspace-preview__node--${node.kind}`}
        data-status={node.status?.label}
        style={node.status ? { "--preview-status": node.status.color } as CSSProperties : undefined}>
        <title>{node.label}{node.status ? ` — ${node.status.label}` : ""}</title>
        <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={Math.min(5, node.width / 4)} />
        {node.width >= 80 && node.height >= 28 && <text x={node.x + 10} y={node.y + 19}>{label}</text>}
        {node.status && node.width >= 80 && node.height >= 48 && <text className="workspace-preview__status"
          x={node.x + 10} y={node.y + 37}>{statusLabel}</text>}
      </g>;
    })}
  </svg>;
}, (previous, next) => JSON.stringify(previous.preview) === JSON.stringify(next.preview));

export function WorkspaceCanvasPreview({ nodes, edges = EMPTY_EDGES, onOpenCanvas }: {
  nodes: CanvasNode[];
  edges?: readonly PreviewEdge[] | undefined;
  onOpenCanvas: () => void;
}) {
  const headingId = useId();
  const preview = useMemo(() => workspaceCanvasPreview(nodes, edges), [nodes, edges]);
  return <section className="workspace-preview" aria-labelledby={headingId}>
    <header className="workspace-preview__header">
      <div className="workspace-preview__heading">
        <PanelsTopLeft size={16} aria-hidden />
        <h3 id={headingId}>Workspace canvas <span>{preview.name}</span></h3>
      </div>
      <button type="button" onClick={onOpenCanvas}>Open canvas <ArrowUpRight size={15} aria-hidden /></button>
    </header>
    {preview.total > 0 ? <>
      <CanvasMap preview={preview} />
      <p className="workspace-preview__caption"><span>{preview.total} {preview.total === 1 ? "node" : "nodes"}</span>
        <span>{preview.simplified ? "Simplified overview · Open canvas for all details" : "Current layout · Read-only preview"}</span></p>
    </> : <div className="workspace-preview__empty">
      <p>No nodes in this workspace yet.</p>
      <span>Open the canvas to add context and arrange your work.</span>
    </div>}
  </section>;
}
