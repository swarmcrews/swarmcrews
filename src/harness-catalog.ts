import type { HarnessInfo } from "./harness-list.ts";

/** Full bootstrap replaces inventory; singleton progress packets patch by harness name. */
export function mergeHarnessCatalog(previous: ReadonlyArray<HarnessInfo>, incoming: ReadonlyArray<HarnessInfo>, baseline: boolean): HarnessInfo[] {
  if (baseline) return sameCatalog(previous, incoming) ? [...previous] : [...incoming];
  const next = [...previous];
  for (const entry of incoming) {
    const index = next.findIndex(item => item.name === entry.name);
    if (index < 0) next.push(entry);
    else if (JSON.stringify(next[index]) !== JSON.stringify(entry)) next[index] = entry;
  }
  return sameCatalog(previous, next) ? [...previous] : next;
}

export function sameCatalog(a: ReadonlyArray<HarnessInfo>, b: ReadonlyArray<HarnessInfo>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
