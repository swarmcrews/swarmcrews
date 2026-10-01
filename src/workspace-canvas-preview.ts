import { activeWorkspaceId, readWorkspaces, visibleZoneNodes } from "./canvas-zones.ts";
import type { CanvasNode } from "./types.ts";
import type { GraphEdge } from "./graph.ts";
import type { LeaderData } from "./nodes/leader/types.ts";
import { STATUS_COLORS } from "./palette.ts";
import { selectWorkItemPresentation } from "../shared/work-item-lifecycle.ts";

export const PREVIEW_WIDTH = 800;
export const PREVIEW_HEIGHT = 220;
export const PREVIEW_NODE_LIMIT = 300;
export const PREVIEW_EDGE_LIMIT = 600;
export type PreviewEdge = Pick<GraphEdge, "id" | "sourceNodeId" | "targetNodeId">;

const AGENT_STATUS_COLORS: Readonly<Record<string, string>> = {
  ...STATUS_COLORS, completed: "var(--status-success)",
};
const BADGE_COLORS = {
  active: "var(--status-running)", success: "var(--status-success)",
  attention: "var(--status-warning)", error: "var(--status-error)",
  neutral: "var(--status-stopped)", archived: "var(--text-muted)",
};

function previewStatus(node: CanvasNode): { label: string; color: string } | null {
  if (!["leader", "minion", "claude-session"].includes(node.type)) return null;
  const data = node.data as Partial<LeaderData> | null;
  // Durable lifecycle state wins over stale run status, including decisions and conflicts.
  if (node.type === "leader" && data?.workItemSnapshot) {
    const snapshot = data.workItemSnapshot;
    const presentation = selectWorkItemPresentation(snapshot.lifecycle, { waitKind: snapshot.waitKind });
    return { label: presentation.label, color: BADGE_COLORS[presentation.badge] };
  }
  if (node.type === "leader" && data?.approvalPending) {
    return { label: "Needs input", color: "var(--status-warning)" };
  }
  const status = data?.status;
  if (!status || !Object.hasOwn(AGENT_STATUS_COLORS, status)) return null;
  return { label: status.charAt(0).toUpperCase() + status.slice(1), color: AGENT_STATUS_COLORS[status]! };
}

/** Geometry, status and short labels only: never copy messages, images or render output. */
export function workspaceCanvasPreview(nodes: CanvasNode[], edges: readonly PreviewEdge[]) {
  const workspaceId = activeWorkspaceId(nodes);
  const name = readWorkspaces(nodes).find(workspace => workspace.id === workspaceId)?.data.name ?? "Global";
  const visible = visibleZoneNodes(nodes, workspaceId).filter(node =>
    [node.position.x, node.position.y, node.size.width, node.size.height].every(Number.isFinite)
    && node.size.width > 0 && node.size.height > 0);
  const selected = visible.slice(0, PREVIEW_NODE_LIMIT);
  const padding = 20;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of visible) {
    left = Math.min(left, node.position.x); top = Math.min(top, node.position.y);
    right = Math.max(right, node.position.x + node.size.width);
    bottom = Math.max(bottom, node.position.y + node.size.height);
  }
  const scale = visible.length ? Math.min((PREVIEW_WIDTH - padding * 2) / (right - left),
    (PREVIEW_HEIGHT - padding * 2) / (bottom - top), 1) : 1;
  const offsetX = (PREVIEW_WIDTH - (right - left) * scale) / 2;
  const offsetY = (PREVIEW_HEIGHT - (bottom - top) * scale) / 2;
  const projected = selected.map(node => {
    const data = node.data as { taskName?: unknown; title?: unknown; name?: unknown } | null;
    const label = [data?.taskName, data?.title, data?.name].find(value => typeof value === "string" && value.trim());
    return { id: node.id, status: previewStatus(node), kind: node.type === "context-group" ? "group" : node.type === "leader" ? "leader" : "context",
      label: (typeof label === "string" ? label.trim() : node.type.replaceAll("-", " ")).slice(0, 80),
      x: (node.position.x - left) * scale + offsetX, y: (node.position.y - top) * scale + offsetY,
      width: node.size.width * scale, height: node.size.height * scale };
  });
  const byId = new Map(projected.map(node => [node.id, node]));
  const connections: { id: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  let edgesTruncated = false;
  for (const edge of edges) {
    const source = byId.get(edge.sourceNodeId), target = byId.get(edge.targetNodeId);
    if (!source || !target) continue;
    if (connections.length === PREVIEW_EDGE_LIMIT) { edgesTruncated = true; break; }
    connections.push({ id: edge.id, x1: source.x + source.width, y1: source.y + source.height / 2,
      x2: target.x, y2: target.y + target.height / 2 });
  }
  return { name, total: visible.length, nodes: projected, edges: connections,
    simplified: visible.length > PREVIEW_NODE_LIMIT || edgesTruncated };
}
export type WorkspacePreview = ReturnType<typeof workspaceCanvasPreview>;
