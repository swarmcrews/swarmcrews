import type { TaskGraphNodeView } from "./types.ts";

export function modelLabel(node: TaskGraphNodeView): string {
  if (node.currentAttempt?.model) return `Model: ${node.currentAttempt.model}`;
  if (node.requestedModel) return `Requested model: ${node.requestedModel}`;
  return node.currentAttempt ? "Model: not recorded" : "Model: default at launch";
}

export function ModelLabel({ node }: { node: TaskGraphNodeView }) {
  const label = modelLabel(node);
  const title = node.currentAttempt?.harness ? `${label} · ${node.currentAttempt.harness}` : label;
  return <span className="tg-model-label" data-unavailable={!node.currentAttempt?.model && !node.requestedModel} title={title}>{label}</span>;
}
