/**
 * Per-leader-session connected-canvas context snapshots.
 *
 * Stored out of band from the SessionHost class so `session-host.ts` stays
 * under its architectural file-size budget. Session continuity persists the
 * snapshot and repopulates this lookup during restart hydration.
 */
const canvasContextBySession = new Map<string, string>();

export interface ConnectedLeaderGraphSource {
  nodeId: string;
  workItemId: string;
  primaryRunKey: string;
}

const graphSourcesBySession = new Map<string, readonly ConnectedLeaderGraphSource[]>();
export interface StoredCanvasContextItem {
  nodeId:string; nodeType:string; label:string; content:string;
  attachments?: Array<{kind:"image";filename?:string;mediaType:"image/jpeg"|"image/png"|"image/gif"|"image/webp";data:string}>;
  leaderGraphSource?: {workItemId:string;primaryRunKey:string};
}
const itemsBySession = new Map<string, readonly StoredCanvasContextItem[]>();

export function getSessionCanvasContext(sessionKey: string): string | null {
  return canvasContextBySession.get(sessionKey) ?? null;
}

export function setSessionCanvasContext(
  sessionKey: string,
  canvasContext: string | null,
): void {
  if (canvasContext) {
    canvasContextBySession.set(sessionKey, canvasContext);
  } else {
    canvasContextBySession.delete(sessionKey);
  }
}

export function getSessionConnectedLeaderGraphSources(sessionKey: string): readonly ConnectedLeaderGraphSource[] {
  return graphSourcesBySession.get(sessionKey) ?? [];
}

export function setSessionConnectedLeaderGraphSources(
  sessionKey: string,
  sources: readonly ConnectedLeaderGraphSource[],
): void {
  if (sources.length) graphSourcesBySession.set(sessionKey, sources);
  else graphSourcesBySession.delete(sessionKey);
}

export function setSessionCanvasContextItems(sessionKey:string,items:readonly StoredCanvasContextItem[]):void {
  if (items.length) itemsBySession.set(sessionKey,items); else itemsBySession.delete(sessionKey);
}

export function getSessionCanvasContextItems(sessionKey:string):readonly StoredCanvasContextItem[] {
  return itemsBySession.get(sessionKey) ?? [];
}
