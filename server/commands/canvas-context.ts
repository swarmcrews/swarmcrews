/**
 * canvas_context - replace the leader session's full connected-canvas snapshot.
 */

import { sanitizeAttachments } from "./attachment-sanitize.ts";
import { unicastGlobal, unicastToSession } from "../bus.ts";
import type { CommandHandler } from "./types.ts";

interface CanvasContextItem {
  nodeId: string;
  nodeType: string;
  label: string;
  content: string;
  attachments?: Array<{
    kind: "image";
    filename?: string;
    mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  }>;
}

export { buildConnectedContextBlock as buildCanvasContextBlock } from "../../shared/connected-context.ts";
import { buildConnectedContextBlock as buildCanvasContextBlock, uniqueContextSources } from "../../shared/connected-context.ts";

function isCanvasContextItem(value: unknown): value is CanvasContextItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.nodeId === "string" &&
    typeof item.nodeType === "string" &&
    typeof item.label === "string" &&
    typeof item.content === "string"
  );
}

export const canvasContext: CommandHandler = (ctx, cmd, ws) => {
  if (!cmd.sessionKey) {
    unicastGlobal(ws, {
      type: "error",
      message: "sessionKey required",
    });
    return;
  }
  if (!Array.isArray(cmd.items) || !cmd.items.every(isCanvasContextItem)) {
    unicastToSession(ws, cmd.sessionKey, {
      type: "error",
      message: "items must be an array of canvas context items",
    });
    return;
  }

  const host = ctx.registry.get(cmd.sessionKey);
  if (!host) {
    unicastToSession(ws, cmd.sessionKey, {
      type: "error",
      message: `Session ${cmd.sessionKey} not found`,
    });
    return;
  }

  host.setCanvasContext(buildCanvasContextBlock(cmd.items), sanitizeAttachments(uniqueContextSources(cmd.items).flatMap(item => item.attachments ?? [])) ?? []);
};
