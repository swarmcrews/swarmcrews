import type { SemanticTaskGraphPlan } from "../../shared/task-graph-planning-contracts.ts";
import type { StoredWorkPacket } from "../system-model/store.ts";
import type { LoadedSystemModel } from "../system-model/types.ts";
import { renderTaskWorkPacketContextPack } from "../system-model/task-context.ts";

type Step = SemanticTaskGraphPlan["steps"][number];

export function graphModelContextFiles(model: LoadedSystemModel | null, step: Step): string[] {
  const modeledPaths = model ? [...model.capabilities, ...model.flows, ...model.surfaces]
    .flatMap(object => [...object.suggestedFiles, ...(object.type === "capability"
      ? object.entryPoints.flatMap(entry => entry.files) : [])]) : [];
  const references = step.contextSelectors.filter(selector => selector.startsWith("repo:"))
    .map(selector => selector.slice(5).trim())
    // repo: also accepts symbols. An unresolved bare symbol is not evidence
    // that a task has no applicable model context; retain the shared fallback.
    .filter(value => /[\\/]/.test(value) || /\.[a-z0-9]+$/i.test(value)
      || modeledPaths.some(file => file.startsWith(`${value}/`)));
  return [...new Set([
    ...step.ownershipRequest.filter(scope => scope.scope === "path").map(scope => scope.normalizedValue),
    ...references,
  ])];
}

/** Shared by preview and source freezing so the inspected bytes are the delivered bytes. */
export function graphWorkPacketContext(model: LoadedSystemModel | null, stored: StoredWorkPacket,
  step: Step): string {
  // The disabled layer retains compatibility with previously stored packets.
  if (!model) return stored.contextPack;
  return renderTaskWorkPacketContextPack(model, stored.packet, {
    objective: step.objective,
    files: graphModelContextFiles(model, step),
    objectIds: step.systemModelObjectIds,
  });
}
