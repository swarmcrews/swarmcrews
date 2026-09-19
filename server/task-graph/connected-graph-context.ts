import { buildConnectedContextBlock, uniqueContextSources } from "../../shared/connected-context.ts";
import { sanitizeAttachments } from "../commands/attachment-sanitize.ts";
import { getSessionCanvasContextItems, setSessionConnectedLeaderGraphSources } from "../canvas-context-store.ts";
import type { ConnectedLeaderGraphSource, StoredCanvasContextItem } from "../canvas-context-store.ts";
import type { TaskGraphPlanningCoordinator } from "./planning-coordinator.ts";
import { connectedGraphSourcesForRecipient } from "./connected-graph-source.ts";

export function graphOverview(inspection: { plan: { objective: string; state: string;
  steps: Array<{ key: string; title: string }>; graphRunId: string | null } | null;
  runtime: { nodes: Array<unknown> } | null }): string | null {
  const plan = inspection.plan;
  if (!plan) return null;
  const nodes = inspection.runtime?.nodes ?? [];
  const status = nodes.length ? `${nodes.length} runtime tasks` : `${plan.steps.length} planned steps`;
  // Keep the entire overview in the retained head of an 8KB source excerpt.
  const objective = plan.objective.slice(0, 400);
  const steps = plan.steps.slice(0, 6).map((step) => `${step.key.slice(0, 60)}: ${step.title.slice(0, 100)}`).join("; ");
  return `[Connected Task Graph overview]\nStatus: ${plan.state} (${status})\nRead-only drilldown: use get_graph_plan with this context-group source-id as connectedSourceId; use read_graph_artifact with the same connectedSourceId only for its committed artifacts.\nObjective: ${objective}\nTopology: ${steps || "no steps"}${plan.steps.length > 6 ? "; …" : ""}`;
}

export function enrichConnectedGraphContext(input: {
  coordinator: TaskGraphPlanningCoordinator;
  recipientWorkItemId: string;
  recipientPrimaryRunKey: string;
  items: readonly StoredCanvasContextItem[];
}): { items: StoredCanvasContextItem[]; sources: ConnectedLeaderGraphSource[]; graphItems: StoredCanvasContextItem[] } {
  const allowed = connectedGraphSourcesForRecipient(input.coordinator.repo.db, {
    workItemId: input.recipientWorkItemId, primaryRunKey: input.recipientPrimaryRunKey,
  });
  const requested = new Set(input.items.filter((item) => item.nodeType === "leader" && item.leaderGraphSource)
    .map((item) => item.nodeId));
  const sources = allowed.filter((source) => requested.has(source.nodeId));
  const byNode = new Map(sources.map((source) => [source.nodeId, source]));
  const graphItems: StoredCanvasContextItem[] = [];
  return { sources, graphItems, items: input.items.map((item) => {
    const source = byNode.get(item.nodeId);
    if (!source) return item.leaderGraphSource ? { ...item, leaderGraphSource: undefined } : item;
    try {
      const overview = graphOverview(input.coordinator.inspectConnected({
        recipientWorkItemId: input.recipientWorkItemId, recipientPrimaryRunKey: input.recipientPrimaryRunKey, source,
      }));
      if (overview) graphItems.push({ nodeId: item.nodeId, nodeType: item.nodeType, label: item.label, content: overview });
      return overview ? { ...item, leaderGraphSource: source, content: `${overview}\n\n${item.content}` } : { ...item, leaderGraphSource: source };
    } catch { return { ...item, leaderGraphSource: undefined }; }
  }) };
}

export function refreshConnectedGraphContext(host: { id: string; workItemId: string | null; runKey: string;
  setCanvasContext(value: string | null, attachments?: Array<{ kind: "image"; filename?: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string }>): void }, coordinator: TaskGraphPlanningCoordinator): string | null {
  if (!host.workItemId) return null;
  const items = getSessionCanvasContextItems(host.id);
  if (!items.length) return null;
  const enriched = enrichConnectedGraphContext({ coordinator, recipientWorkItemId: host.workItemId,
    recipientPrimaryRunKey: host.runKey, items });
  setSessionConnectedLeaderGraphSources(host.id, enriched.sources);
  host.setCanvasContext(buildConnectedContextBlock(enriched.items),
    sanitizeAttachments(uniqueContextSources(enriched.items).flatMap((item) => item.attachments ?? [])) ?? []);
  return buildConnectedContextBlock(enriched.graphItems)?.replaceAll("connected-context>", "connected-context-update>") ?? null;
}

/** Send only graph summaries on ordinary resumes, not the entire transcript. */
export function prependGraphContext(
  prompt: string | AsyncIterable<{ role: "user"; content: string }>, context: string | null,
): string | AsyncIterable<{ role: "user"; content: string }> {
  if (!context) return prompt;
  if (typeof prompt === "string") return `${context}\n\n${prompt}`;
  return (async function* () {
    let first = true;
    for await (const message of prompt) {
      yield first ? { ...message, content: `${context}\n\n${message.content}` } : message;
      first = false;
    }
  })();
}
