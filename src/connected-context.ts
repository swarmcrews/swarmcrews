/**
 * Utilities for delta-based connected-context injection in LeaderNode.
 * IMPORTANT: The exact wrapper text produced by `buildContextBlock` is
 * matched by a regex inside `server/session-host-config.ts` `deriveTaskName`.
 * Do NOT change it without also updating that regex.
 */

import type { ContextItem } from "./types.ts";

export type CanvasContextSignature = string | null;

export interface CanvasContextSnapshotSendArgs {
  socketSend?: ((data: unknown) => void) | undefined;
  sessionKey: string | null | undefined;
  items: ContextItem[];
  previousSignature: CanvasContextSignature;
}

export { hashString, itemContentHash } from "../shared/connected-context.ts";
import { buildConnectedContextBlock, itemContentHash, uniqueContextSources } from "../shared/connected-context.ts";

export const buildContextBlock = buildConnectedContextBlock;

export function canvasContextSignature(
  items: ContextItem[],
): CanvasContextSignature {
  if (items.length === 0) return null;
  return uniqueContextSources(items)
    .map((item) => `${item.nodeId}:${itemContentHash(item)}`)
    .join("|");
}

export function sendCanvasContextSnapshotIfChanged({
  socketSend,
  sessionKey,
  items,
  previousSignature,
}: CanvasContextSnapshotSendArgs): CanvasContextSignature {
  const nextSignature = canvasContextSignature(items);
  if (!socketSend || !sessionKey || nextSignature === previousSignature) {
    return previousSignature;
  }
  // `blocks` is client-side delivery metadata (duplicate of `content`);
  // strip it so the server snapshot payload isn't doubled.
  const wireItems = uniqueContextSources(items).map(({ blocks: _blocks, ...rest }) => rest);
  socketSend({ type: "canvas_context", sessionKey, items: wireItems });
  return nextSignature;
}
