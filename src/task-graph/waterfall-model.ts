import type { TaskAttemptView, TaskGraphNodeView, TaskGraphSnapshotView } from "./types.ts";

export interface ExecutionSegment {
  attempt: TaskAttemptView;
  start: number;
  end: number;
  running: boolean;
  finishUnknown: boolean;
}

export function timestamp(value?: string): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Current attempt wins over its historical copy. Missing times are not estimates. */
export function executionSegments(node: TaskGraphNodeView, now: number): ExecutionSegment[] {
  const attempts = new Map(node.attemptHistory.map((attempt) => [attempt.id, attempt]));
  if (node.currentAttempt) attempts.set(node.currentAttempt.id, node.currentAttempt);
  return [...attempts.values()].flatMap((attempt) => {
    const start = timestamp(attempt.startedAt);
    if (start === null || (attempt.state === "queued" && !attempt.finishedAt)) return [];
    const finish = timestamp(attempt.finishedAt);
    const running = attempt.id === node.currentAttempt?.id && attempt.state === "running" && finish === null
      && node.logicalState === "pending";
    // An attempt without a recorded finish remains a timestamp marker unless it
    // is the currently running attempt. Never stretch failed/queued history.
    return [{ attempt, start, end: Math.max(start, finish ?? (running ? now : start)), running,
      finishUnknown: finish === null && !running }];
  }).sort((a, b) => a.start - b.start || a.attempt.number - b.attempt.number || a.attempt.id.localeCompare(b.attempt.id));
}

/** Topological order depends only on identities and edges, never live status/priority. */
export function executionOrder(snapshot: TaskGraphSnapshotView): TaskGraphNodeView[] {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const incoming = new Map(snapshot.nodes.map((node) => [node.id, new Set<string>()]));
  const outgoing = new Map(snapshot.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of snapshot.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    incoming.get(edge.target)!.add(edge.source);
    outgoing.get(edge.source)!.add(edge.target);
  }
  const ready = snapshot.nodes.filter((node) => !incoming.get(node.id)!.size).map((node) => node.id).sort();
  const ordered: TaskGraphNodeView[] = [];
  const visited = new Set<string>();
  while (ready.length) {
    const id = ready.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    ordered.push(nodes.get(id)!);
    const next: string[] = [];
    for (const target of outgoing.get(id) ?? []) {
      incoming.get(target)!.delete(id);
      if (!incoming.get(target)!.size) next.push(target);
    }
    // Follow newly unlocked sequences before moving to unrelated roots.
    ready.unshift(...next.sort());
  }
  // Partial/cyclic projections must remain visible rather than hang the view.
  return [...ordered, ...snapshot.nodes.filter((node) => !visited.has(node.id)).sort((a, b) => a.id.localeCompare(b.id))];
}

export function executionBounds(snapshot: TaskGraphSnapshotView, now: number) {
  const segments = snapshot.nodes.flatMap((node) => executionSegments(node, now));
  const start = segments.length ? Math.min(...segments.map((segment) => segment.start)) : timestamp(snapshot.updatedAt) ?? now;
  const end = Math.max(start, ...segments.map((segment) => segment.end));
  return { start, end, duration: end - start };
}

export function timeTick(duration: number): number {
  const target = Math.max(1_000, duration / 6);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  return ([1, 2, 5, 10].find((factor) => factor * magnitude >= target) ?? 10) * magnitude;
}

export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
