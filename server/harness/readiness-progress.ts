import type { HarnessReadiness } from "./readiness-types.ts";

/** Probe-result subscriptions are ephemeral; only the authoritative readiness snapshot is cached. */
export class ReadinessProgress {
  private generation = 0;
  private completed = new Map<string, HarnessReadiness>();
  private listeners = new Set<(item: HarnessReadiness) => void>();

  reset(): number {
    this.generation++;
    this.completed.clear();
    this.listeners.clear();
    return this.generation;
  }

  publish(generation: number, item: HarnessReadiness): void {
    if (generation !== this.generation) return;
    this.completed.set(item.name, item);
    for (const listener of this.listeners) listener(item);
  }

  current(): HarnessReadiness[] { return [...this.completed.values()]; }
  isCurrent(generation: number): boolean { return generation === this.generation; }
  subscribe(listener: (item: HarnessReadiness) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
