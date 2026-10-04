import { useCallback, useEffect, useMemo, useSyncExternalStore, type SetStateAction } from 'react';
import type { CanvasNode } from '../../../types.ts';
import type { LeaderData } from '../types.ts';

interface Entry {
  scope: string | undefined;
  fields: Map<string, unknown>;
  listeners: Set<() => void>;
}
// Browser-memory only. No persisted node data, localStorage or server writes.
const entries = new Map<string, Entry>();

export function leaderDraftScope(projectId: string | undefined, nodeId: string, data: Partial<LeaderData>): string {
  const run = data.currentRunKey !== undefined ? data.currentRunKey
    : data.workItemSnapshot ? data.workItemSnapshot.currentRunKey : data.sessionKey ?? null;
  return JSON.stringify([projectId ?? null, nodeId, data.workItemId ?? data.workItemSnapshot?.id ?? null, run]);
}

function entryFor(scope: string): Entry {
  let entry = entries.get(scope);
  if (!entry) {
    entry = { scope, fields: new Map(), listeners: new Set() };
    entries.set(scope, entry);
  }
  return entry;
}

/** Only an explicit Start allocation may carry its own composer into its newly bound identity. */
export function carryLeaderLaunchDraft(from: string, to: string) {
  if (from === to) return;
  const entry = entries.get(from);
  if (!entry || entries.has(to)) return; // Never replace another target's draft.
  entries.delete(from);
  entry.scope = to;
  entries.set(to, entry);
}

/** Shared by the node's composers, including across Activity/Canvas unmounts. */
export function useLeaderDraftField<T>(scope: string | undefined, field: string, empty: T) {
  const entry = useMemo(() => scope === undefined
    ? { scope, fields: new Map<string, unknown>(), listeners: new Set<() => void>() } : entryFor(scope), [scope]);
  const subscribe = useCallback((listener: () => void) => {
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, [entry]);
  const snapshot = useCallback(() => entry.fields.has(field) ? entry.fields.get(field) as T : empty,
    [entry, field, empty]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setValue = useCallback((next: SetStateAction<T>) => {
    // Async attachment/launch callbacks must never resurrect a removed identity.
    if (entry.scope !== undefined && entries.get(entry.scope) !== entry) return;
    const before = entry.fields.has(field) ? entry.fields.get(field) as T : empty;
    const after = typeof next === 'function' ? (next as (value: T) => T)(before) : next;
    if (Object.is(before, after)) return;
    entry.fields.set(field, after);
    entry.listeners.forEach(listener => listener());
  }, [scope, entry, field, empty]);
  return [value, setValue] as const;
}

/** Explicit reset/removal or a changed run invalidates pending callbacks too. */
export function forgetLeaderDrafts(keep: ReadonlySet<string> = new Set()) {
  for (const [scope, entry] of entries) {
    if (keep.has(scope)) continue;
    entries.delete(scope);
    entry.fields.clear();
    entry.listeners.forEach(listener => listener());
  }
}

export function useLeaderDraftLifetimes(projectId: string, nodes: CanvasNode[], loaded: boolean) {
  useEffect(() => {
    if (!loaded) return;
    const keep = new Set(nodes.filter(node => node.type === 'leader').map(node =>
      leaderDraftScope(projectId, node.id, node.data as LeaderData)));
    // Mounted prelaunch composers may not yet own a persisted Canvas node.
    for (const [scope, entry] of entries) if (entry.listeners.size) keep.add(scope);
    forgetLeaderDrafts(keep);
  }, [projectId, nodes, loaded]);
}
