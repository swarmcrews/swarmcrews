import type { ServerMessage } from "./use-socket.ts";
import type { SessionStreamState } from "./session-stream.ts";

/** Cursor always refers to the last *delivered* row; highWater is only a server hint. */
export function deliveredHistoryCursor(
  prior: SessionStreamState, response: Extract<ServerMessage, { type: "sync_response" }>,
): number | undefined {
  const last = response.events?.at(-1)?.historyId;
  if (response.history?.reset) return typeof last === "number" ? last : 0;
  if (typeof last === "number") return Math.max(prior.historyHighWater ?? 0, last);
  return prior.historyHighWater;
}

export function nextHistoryPage(response: Extract<ServerMessage, { type: "sync_response" }>): number | null {
  return response.history?.nextAfter ?? null;
}
