import type { ClaudeSessionData } from "./ClaudeSessionNode.tsx";
import type { ServerMessage } from "../use-socket.ts";
import { deliveredHistoryCursor } from "../session-recovery.ts";
import { sessionStreamReducer, type SessionStreamState } from "../session-stream.ts";

// Claude's status banners own these events, unlike the Leader transcript.
const bannerKinds = new Set(["api_retry", "rate_limit"]);
export function reduceClaudeSession(current: ClaudeSessionData, message: ServerMessage): ClaudeSessionData {
  if (message.type === "sdk_event" && (bannerKinds.has(message.event.kind)
    || message.event.kind === "thinking" && !current.streamingThinkingText && current.streamingThinkingBlockIndex == null)) return current;
  const state: SessionStreamState = { ...current, streamingBlockIndex: current.streamingBlockIndex ?? null };
  const replay = message.type === "sync_response" ? { ...message,
    events: (message.events ?? []).filter(event => event.type !== "sdk_event" || !event.event || !bannerKinds.has(event.event.kind)),
  } : message;
  const next = sessionStreamReducer(state, replay, "claude");
  if (next === state) return current;
  return { ...current, ...next,
    messages: next.messages.some(message => message.role === "thinking")
      ? next.messages.filter(message => message.role !== "thinking") : next.messages,
    sessionKey: next.sessionKey ?? current.sessionKey,
    status: message.type === "sdk_event" && message.event.kind === "done" ? "idle"
      : next.status === "completed" ? "idle" : next.status,
    ...(message.type === "sync_response" && message.found ? {
      historyHighWater: deliveredHistoryCursor(state, message),
      model: (message.model as ClaudeSessionData["model"] | null | undefined) ?? current.model,
      permissionMode: (message.permissionMode as ClaudeSessionData["permissionMode"]) ?? current.permissionMode,
      ...(message.harness ? { harness: message.harness } : {}),
    } : {}),
    ...(message.type === "sdk_event" && message.event.kind === "done" ? { promptSuggestions: [] } : {}),
    ...(message.type === "session_cleared" ? { totalCost: 0, turns: 0, subagents: [], promptSuggestions: [] } : {}),
  };
}
