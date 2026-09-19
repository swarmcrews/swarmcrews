import type { WorkPacket } from "../../shared/system-model/index.ts";
import { expandScope, pathsOverlap } from "./compile-scope.ts";
import { renderWorkPacketContextPack } from "./compile.ts";
import type { LoadedSystemModel } from "./types.ts";

export interface TaskModelContext {
  objective: string;
  files: string[];
  objectIds?: string[];
}

/** A prompt projection only: never amends the packet, evidence, or execution authority. */
export function renderTaskWorkPacketContextPack(model: LoadedSystemModel, packet: WorkPacket, task: TaskModelContext): string {
  const packetIds = new Set([
    ...packet.scope.capabilities, ...packet.scope.flows, ...(packet.scope.surfaces ?? []),
    ...packet.scope.constraints, ...packet.scope.decisions, ...packet.scope.risks,
  ]);
  for (const id of task.objectIds ?? []) {
    if (!packetIds.has(id) || !model.objectsById.has(id)) {
      throw new Error(`System-model selection ${id} is unavailable in Work Packet ${packet.id}. Amend the packet before selecting it.`);
    }
  }
  // A synthesis/review task without concrete hints may need the entire packet.
  // Do not infer a narrower scope from the lexical search ranker.
  if (!task.files.length && !task.objectIds?.length) {
    return renderWorkPacketContextPack(model, { ...packet, normalizedGoal: task.objective });
  }
  const matchesFiles = (globs: string[]) => globs.some(glob => task.files.some(file => {
    const scope = file.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    return pathsOverlap(glob, scope) || glob.startsWith(`${scope}/`) || scope.startsWith(`${glob}/`);
  }));
  const seeds = new Set(task.objectIds ?? []);
  for (const object of [...model.capabilities, ...model.flows, ...model.surfaces]) {
    if (!packetIds.has(object.id)) continue;
    const paths = [...object.suggestedFiles, ...object.suggestedTests,
      ...(object.type === "capability" ? object.entryPoints.flatMap(entry => [...entry.files, ...entry.tests]) : [])];
    if (matchesFiles(paths)) seeds.add(object.id);
  }
  const expanded = expandScope(model, [...seeds], task.files);
  const entryPoints = expanded.capabilities.flatMap(capability => capability.entryPoints
    .filter(entry => task.files.length ? matchesFiles([...entry.files, ...entry.tests])
      : seeds.has(capability.id) || seeds.has(entry.surface))
    .map(entry => ({ capabilityId: capability.id, surfaceId: entry.surface,
      files: entry.files, tests: entry.tests, flows: entry.flows })));
  const surfaces = [...new Set([
    ...model.surfaces.filter(surface => seeds.has(surface.id)).map(surface => surface.id),
    ...entryPoints.map(entry => entry.surfaceId),
  ])];
  const selected = new Set([
    ...expanded.capabilities, ...expanded.flows,
    ...expanded.constraints, ...expanded.decisions, ...expanded.risks,
  ].map(object => object.id));
  for (const id of surfaces) selected.add(id);
  const domains = new Set([...expanded.capabilities, ...expanded.flows].map(object => object.domain));
  // Shared safeguards still apply even when a file has no modeled behavior.
  for (const constraint of model.constraints) {
    const applies = constraint.appliesTo;
    if (matchesFiles(applies.files)
      || [...applies.capabilities, ...applies.flows, ...applies.surfaces].some(id => selected.has(id))
      || (!applies.files.length && (constraint.scope === "global"
        || (constraint.scope === "domain" && domains.has(constraint.domain))))) {
      selected.add(constraint.id);
    }
  }
  const constraints = model.constraints.filter(object => selected.has(object.id));
  for (const constraint of constraints) for (const id of constraint.evidence) selected.add(id);
  const relevant = (ids: string[]) => !ids.length || ids.some(id => selected.has(id));
  const coverage = (packet.criterionCoverage ?? []).filter(item => relevant(item.objectIds));
  const criterionIds = new Set(coverage.map(item => item.criterionId));
  const relevantState = (item: { objectIds: string[]; criterionIds: string[] }) =>
    item.objectIds.length ? relevant(item.objectIds)
      : !item.criterionIds.length || item.criterionIds.some(id => criterionIds.has(id));
  const instructions = new Set(model.constraints.flatMap(constraint => constraint.agentInstruction ? [constraint.agentInstruction] : []));
  const projected: WorkPacket = {
    ...packet,
    normalizedGoal: task.objective,
    scope: {
      capabilities: expanded.capabilities.map(item => item.id),
      flows: expanded.flows.map(item => item.id),
      surfaces, entryPoints,
      constraints: constraints.map(item => item.id),
      decisions: model.decisions.filter(item => selected.has(item.id)).map(item => item.id),
      risks: model.risks.filter(item => selected.has(item.id)).map(item => item.id),
      suggestedFiles: task.files.length ? task.files : [...new Set([
        ...expanded.capabilities.flatMap(item => item.suggestedFiles),
        ...expanded.flows.flatMap(item => item.suggestedFiles),
        ...entryPoints.flatMap(entry => entry.files),
      ])],
      suggestedTests: [...new Set([
        ...expanded.capabilities.flatMap(item => item.suggestedTests),
        ...expanded.flows.flatMap(item => item.suggestedTests),
        ...constraints.flatMap(item => item.suggestedTests),
        ...entryPoints.flatMap(entry => entry.tests),
      ])],
    },
    agentInstructions: packet.agentInstructions.filter(instruction => !instructions.has(instruction)),
    criterionCoverage: coverage,
    signals: (packet.signals ?? []).filter(relevantState),
    evidenceLedger: (packet.evidenceLedger ?? []).filter(relevantState),
    freshness: {
      ...packet.freshness,
      warnings: packet.freshness.warnings.filter(warning => !warning.startsWith("Freshness stale for ")
        || selected.has(warning.slice("Freshness stale for ".length))),
      requiredVerifications: packet.freshness.requiredVerifications.filter(verification =>
        !model.objectsById.has(verification.target) || selected.has(verification.target)),
    },
  };
  return renderWorkPacketContextPack(model, projected);
}
