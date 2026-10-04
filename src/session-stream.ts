import { appendThinkingDelta, clearThinkingStream, EMPTY_THINKING_STREAM, thinkingStreamPatch, type ThinkingStreamState } from "./thinking-stream.ts";
/**
 * Pure reducer for the shared session-stream state.
 * Key behaviours preserved:
 *   • `sync_response` → rebuild messages / cost / turns / status / error,
 *     or reset to "disconnected" when the server says the session is gone.
 *   • `sdk_event` → either accumulate streaming deltas, clear them on
 *     stream end, or convert through `normalizedToDisplayMessages`,
 *     deduplicate by `id`, collapse the duplicated assistant-then-result
 *     bubble, and capture cost/turns from usage/done events.
 *   • `session_status` → status update.
 *   • `session_error` → status:"error" + capture error text.
 *
 * **Reference equality contract:** when a message is irrelevant (wrong
 * `sessionKey`, unhandled type, or no observable change) the reducer
 * returns the *same* `state` reference so React's `===` short-circuits
 * the render.
 */

import {
  normalizedToDisplayMessages,
  type DisplayMessage,
} from "./sdk-messages.ts";
import {
  extractParentId,
  extractStreamDelta,
  isStreamEnd,
  isStreamingEvent,
} from "./streaming.ts";
import type { ServerMessage } from "./use-socket.ts";
import type { ContextDeliveryLedger } from "./context-delivery.ts";
import type { NormalizedEvent } from "../shared/normalized-event.ts";
import { deliveredHistoryCursor } from "./session-recovery.ts";
import { isArchiveDisplayMessage } from "./archive-display.ts";

/** Statuses tracked by the shared session stream. */
export type SessionStreamStatus =
  | "disconnected"
  | "creating"
  | "running"
  | "idle"
  | "stopped"
  | "completed"
  | "error";

/**
 * The shared subset of node state the reducer owns.
 *
 * Each node type wraps this in its own data interface (e.g. `LeaderData`
 * adds `taskPlan`, `worktreeBranch`, etc.). The node's own reducer/effect
 * spreads `SessionStreamState` over its own state on each transition.
 */
export interface SessionStreamState extends ThinkingStreamState {
  /** Server-assigned key used to filter inbound WS traffic. */
  sessionKey: string | null;
  /** Contiguous delivered replay cursor, never advanced by live traffic. */
  historyHighWater?: number | undefined;
  /** Highest live row seen; guards duplicate traffic/stale snapshots, not replay. */
  highestLiveHistoryId?: number | undefined;
  status: SessionStreamStatus;
  /** Rendered chat feed (deduplicated, collapsed). */
  messages: DisplayMessage[];
  /** Live partial-text buffer; cleared on assistant/result/stream-end. */
  streamingText: string;
  /**
   * Anthropic content block index that {@link streamingText} belongs to,
   * or `null` when no block is currently streaming. The reducer flushes
   * the buffer whenever a delta arrives for a different index — without
   * this, text from `[text, tool_use, text]` would mash blocks 0 and 2
   * into a single preview bubble while the static render correctly
   * splits them.
   */
  streamingBlockIndex: number | null;
  totalCost: number;
  turns: number;
  error: string | null;
  fullError?: string | null;
  contextDelivery?: ContextDeliveryLedger | undefined;
}

/**
 * The reducer.
 *
 * @param state   current shared state
 * @param msg     inbound WebSocket message
 * @param prefix  passed to `normalizedToDisplayMessages` for stable, scoped IDs
 * @returns       next state, or the same `state` reference if nothing changed
 */
/** Bound client transcript state as well as server replay. The archive remains accessible. */
export function sessionStreamReducer(state: SessionStreamState, msg: ServerMessage, prefix: string): SessionStreamState {
  if (msg.type === "sdk_event" && msg.sessionKey === state.sessionKey && msg.historyId !== undefined
    && msg.historyId <= Math.max(state.historyHighWater ?? 0, state.highestLiveHistoryId ?? 0)) return state;

  if (msg.type === "sync_response" && msg.sessionKey === state.sessionKey
    && msg.afterHistoryId === undefined && msg.history && msg.history.highWater > 0
    && msg.history.highWater < Math.max(state.historyHighWater ?? 0, state.highestLiveHistoryId ?? 0) && !msg.history.reset) return state;
  const incremental = msg.type === "sync_response" && msg.afterHistoryId !== undefined && msg.found && !msg.history?.reset;
  const reduced = incremental ? reduceIncrementalSync(state, msg, prefix)
    : unboundedSessionStreamReducer(state, msg, prefix);
  const terminal = msg.type === "session_status" && !["running", "creating"].includes(msg.status)
    || msg.type === "session_error" || msg.type === "session_cleared"
    || msg.type === "sync_response" && msg.status !== undefined && !["running", "creating"].includes(msg.status);
  const next = terminal && msg.sessionKey === state.sessionKey ? clearThinkingStream(reduced) : reduced;
  const highestLiveHistoryId = msg.type === "sdk_event" && msg.sessionKey === state.sessionKey
    && msg.historyId !== undefined ? Math.max(state.highestLiveHistoryId ?? 0, msg.historyId)
    : msg.type === "sync_response" && msg.history?.reset ? undefined : next.highestLiveHistoryId;
  if (next === state && highestLiveHistoryId === state.highestLiveHistoryId) return state;
  let bytes = 0;
  let start = next.messages.length;
  while (start > 0 && next.messages.length - start < 200) {
    const message = next.messages[start - 1]!;
    const size = JSON.stringify(message).length * 2;
    if (bytes + size > 512 * 1024) break;
    bytes += size; start--;
  }
  const retainedMessages = start ? next.messages.slice(start) : next.messages;
  const retained = msg.type === "sdk_event" && msg.historyId !== undefined
    ? withDisplayHistory(state.messages, retainedMessages, msg.historyId, msg.timestamp) : retainedMessages;
  const messages = retained.some(isArchiveDisplayMessage) ? retained.filter(message => !isArchiveDisplayMessage(message)) : retained;
  if (start && state.sessionKey) messages.unshift({ id: `${prefix}-archive`, role: "system", timestamp: 0,
    content: `[Read session history](/api/history/${encodeURIComponent(state.sessionKey)})` });
  return { ...next, messages, historyHighWater: msg.type === "sync_response"
    ? deliveredHistoryCursor(state, msg) : next.historyHighWater,
    highestLiveHistoryId, streamingText: next.streamingText.slice(-65536),
    streamingThinkingText: (next.streamingThinkingText ?? "").slice(-65536) };
}

/** Apply ascending replay as events, never replace transcript or supersede live events. */
function reduceIncrementalSync(state: SessionStreamState,
  msg: Extract<ServerMessage, { type: "sync_response" }>, prefix: string): SessionStreamState {
  if (msg.sessionKey !== state.sessionKey) return state;
  let next = state;
  for (const event of msg.events ?? []) {
    // Fold before later live messages so old result collapsing cannot delete
    // newer turns. Replay acknowledgement remains separate from live delivery.
    const previous = next;
    const split = event.historyId === undefined ? -1 : next.messages.findIndex(message =>
      message.historyId !== undefined && message.historyId > event.historyId!);
    const later = split < 0 ? [] : next.messages.slice(split);
    const before = split < 0 ? next : { ...next, messages: next.messages.slice(0, split) };
    next = before;
    if (event.type === "sdk_event" && event.event) {
      next = reduceSdkEvent(next, { type: "sdk_event", sessionKey: msg.sessionKey,
        event: event.event, ...(event.historyId !== undefined ? { historyId: event.historyId } : {}),
        ...(event.historyRef ? { historyRef: event.historyRef } : {}) }, prefix);
    } else if (event.type === "session_compacted") {
      next = reduceSessionCompacted(next, { type: "session_compacted", sessionKey: msg.sessionKey,
        ...(event.checkpointId ? { checkpointId: event.checkpointId } : {}),
        ...(event.trigger ? { trigger: event.trigger } : {}), timestamp: event.timestamp,
        oldSessionId: null, newSessionId: null }, prefix);
    } else if (event.type === "session_error" && event.error) {
      next = reduceSessionError(next, { type: "session_error", sessionKey: msg.sessionKey,
        error: event.error, ...(event.fullError ? { fullError: event.fullError } : {}) });
    }
    const messages = withDisplayHistory(before.messages, next.messages, event.historyId, event.timestamp);
    const seen = new Set(messages.map(message => message.id));
    next = { ...next, messages: [...messages, ...later.filter(message => !seen.has(message.id))],
      ...(later.length ? { streamingText: previous.streamingText, streamingBlockIndex: previous.streamingBlockIndex,
        streamingThinkingText: previous.streamingThinkingText, streamingThinkingBlockIndex: previous.streamingThinkingBlockIndex } : {}),
      // Transient deltas have no message row in `later`; older replay pages
      // must not duplicate them or clear a newer live thinking block.
      ...(event.historyId !== undefined && event.historyId <= (state.highestLiveHistoryId ?? 0)
        ? thinkingStreamPatch(previous) : {}) };
  }
  return { ...next, status: (msg.status as SessionStreamStatus | undefined) ?? next.status,
    totalCost: msg.totalCost ?? next.totalCost, turns: msg.turns ?? next.turns,
    error: msg.lastError !== undefined ? msg.lastError : next.error,
    ...(msg.lastErrorFull !== undefined ? { fullError: msg.lastErrorFull } : {}) };
}

function withDisplayHistory(prior: DisplayMessage[], messages: DisplayMessage[], historyId?: number, timestamp?: number): DisplayMessage[] {
  if (historyId === undefined) return messages;
  const existing = new Set(prior.map(message => message.id));
  return messages.map(message => existing.has(message.id) ? message
    : { ...message, historyId, ...(timestamp !== undefined ? { timestamp } : {}) });
}

function unboundedSessionStreamReducer(
  state: SessionStreamState,
  msg: ServerMessage,
  prefix: string,
): SessionStreamState {
  switch (msg.type) {
    case "session_cleared":
      return msg.sessionKey === state.sessionKey ? { ...state, messages: [],
        streamingText: "", streamingBlockIndex: null, ...EMPTY_THINKING_STREAM, error: null, fullError: null,
        historyHighWater: undefined, highestLiveHistoryId: undefined, contextDelivery: {} } : state;
    case "sync_response":
      return reduceSyncResponse(state, msg, prefix);
    case "sdk_event":
      return reduceSdkEvent(state, msg, prefix);
    case "session_status":
      return reduceSessionStatus(state, msg);
    case "session_error":
      return reduceSessionError(state, msg);
    case "session_compacted":
      return reduceSessionCompacted(state, msg, prefix);
    default:
      return state;
  }
}

function reduceSessionCompacted(
  state: SessionStreamState,
  msg: Extract<ServerMessage, { type: "session_compacted" }>,
  prefix: string,
): SessionStreamState {
  if (msg.sessionKey !== state.sessionKey) return state;
  const marker = checkpointDisplayMessage(prefix, msg.checkpointId ?? String(msg.timestamp), msg.trigger, msg.timestamp);
  if (state.messages.some((message) => message.id === marker.id)) return state;
  return {
    ...state,
    messages: [...state.messages, marker],
    contextDelivery: {},
  };
}

function checkpointDisplayMessage(prefix: string, id: string, trigger: "proactive" | "context_recovery" | undefined, timestamp: number): DisplayMessage {
  const reason = trigger === "context_recovery" ? "after context-window recovery" : "at a context checkpoint";
  return { id: `${prefix}-checkpoint-${id}`, role: "system", content: `Continued in a fresh thread ${reason}.`, timestamp };
}

// ── sync_response ────────────────────────────────────────

function reduceSyncResponse(
  state: SessionStreamState,
  msg: Extract<ServerMessage, { type: "sync_response" }>,
  prefix: string,
): SessionStreamState {
  if (msg.sessionKey !== state.sessionKey) return state;

  if (!msg.found) {
    // Server lost the session — clear streaming buffer and disconnect.
    return {
      ...state,
      status: "disconnected",
      sessionKey: null,
      streamingText: "",
      streamingBlockIndex: null,
      ...EMPTY_THINKING_STREAM,
      error: null,
      fullError: null,
    };
  }

  const events = msg.events ?? [];
  let rebuilt: DisplayMessage[] = [];
  const seen = new Set<string>();
  let cost = msg.totalCost ?? state.totalCost;
  let turns = msg.turns ?? state.turns;
  let error = msg.lastError ?? null;
  let fullError = msg.lastErrorFull ?? error;
  let status: SessionStreamStatus =
    (msg.status as SessionStreamStatus | undefined) ?? state.status;
  let streaming = emptySessionStreamState(state.sessionKey);

  for (const evt of events) {
    if (evt.type === "sdk_event" && evt.event) {
      const event = evt.event;
      if (!evt.historyRef) rebuilt = retainChangedPaths(rebuilt, event, prefix);
      if (isStreamingEvent(event) && !evt.historyRef) {
        streaming = reduceSdkEvent(streaming, {
          type: "sdk_event", sessionKey: msg.sessionKey, event,
        }, prefix);
        continue;
      }
      if ((event.kind === "text" && event.role === "assistant")
        || event.kind === "done") {
        streaming = { ...streaming, streamingText: "", streamingBlockIndex: null };
      }
      if (event.kind === "thinking" || event.kind === "done") streaming = clearThinkingStream(streaming);
      const produced = evt.historyRef ? []
        : normalizedToDisplayMessages(event, displayPrefix(prefix, event, evt.historyId));
      const filtered = collapseAssistantResultDup(rebuilt, produced, event);
      for (const m of filtered.appended) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          rebuilt.push(evt.historyId !== undefined ? { ...m, historyId: evt.historyId, timestamp: evt.timestamp } : m);
        }
      }
      if (filtered.dropAssistantIdx >= 0) {
        // Drop the prior assistant bubble that the result is collapsing.
        const dropped = rebuilt[filtered.dropAssistantIdx];
        if (dropped) seen.delete(dropped.id);
        rebuilt.splice(filtered.dropAssistantIdx, 1);
      }
      if (event.kind === "usage" && event.costUSD != null) {
        cost = event.costUSD;
      }
      if (event.kind === "done" && event.turns != null) {
        turns = event.turns;
      }
    } else if (evt.type === "session_status" && evt.status) {
      status = evt.status as SessionStreamStatus;
    } else if (evt.type === "session_error" && evt.error) {
      status = "error";
      error = evt.error;
      fullError = evt.fullError ?? evt.error;
    } else if (evt.type === "session_compacted") {
      const marker = { ...checkpointDisplayMessage(prefix, evt.checkpointId ?? String(evt.timestamp), evt.trigger, evt.timestamp),
        ...(evt.historyId !== undefined ? { historyId: evt.historyId } : {}) };
      if (!seen.has(marker.id)) { seen.add(marker.id); rebuilt.push(marker); }
    }
  }

  if (msg.history?.before) rebuilt.unshift({ id: `${prefix}-archive`, role: "system",
    content: `[Read earlier session history](${msg.history.url}?before=${msg.history.before})`, timestamp: 0 });
  return {
    ...state,
    status: msg.history ? (msg.status as SessionStreamStatus | undefined) ?? status : status,
    messages: msg.history && !msg.history.reset && Math.max(state.historyHighWater ?? 0, state.highestLiveHistoryId ?? 0) > (Number(events.at(-1)?.historyId ?? 0))
      ? [...rebuilt, ...state.messages.filter(m =>
        !rebuilt.some(replayed => replayed.id === m.id) && m.id !== `${prefix}-archive`)]
      : rebuilt.length > 0 || msg.history?.reset ? rebuilt : state.messages.some(isArchiveDisplayMessage)
        ? state.messages.filter(m => !isArchiveDisplayMessage(m)) : state.messages,
    contextDelivery: rebuilt.some(m => m.id.startsWith(`${prefix}-checkpoint-`)
      && !state.messages.some(old => old.id === m.id)) ? {} : state.contextDelivery,
    streamingText: streaming.streamingText,
    streamingBlockIndex: streaming.streamingBlockIndex,
    streamingThinkingText: streaming.streamingThinkingText,
    streamingThinkingBlockIndex: streaming.streamingThinkingBlockIndex,
    totalCost: msg.history ? msg.totalCost ?? cost : cost,
    turns: msg.history ? msg.turns ?? turns : turns,
    error: msg.history && msg.lastError !== undefined ? msg.lastError : error,
    fullError: msg.history && msg.lastErrorFull !== undefined ? msg.lastErrorFull : fullError,
  };
}

// ── sdk_event ────────────────────────────────────────────

// Text and thinking events can repeat identical content; immutable row IDs
// distinguish separate turns while matching the same event in live and replay.
function displayPrefix(prefix: string, event: NormalizedEvent, historyId?: number): string {
  return historyId !== undefined && (event.kind === "text" || event.kind === "thinking")
    ? `${prefix}-history-${historyId}` : prefix;
}

function reduceSdkEvent(state: SessionStreamState,
  msg: Extract<ServerMessage, { type: "sdk_event" }>, prefix: string): SessionStreamState {
  if (!state.sessionKey || msg.sessionKey !== state.sessionKey) return state;
  if (msg.event.kind === "thinking_delta") return msg.historyRef ? state : appendThinkingDelta(state, msg.event);
  const next = reduceSdkEventBody(state, msg, prefix);
  return ["thinking", "done", "stream_end"].includes(msg.event.kind) ? clearThinkingStream(next) : next;
}

function reduceSdkEventBody(
  state: SessionStreamState,
  msg: Extract<ServerMessage, { type: "sdk_event" }>,
  prefix: string,
): SessionStreamState {
  if (!state.sessionKey || msg.sessionKey !== state.sessionKey) return state;
  const event: NormalizedEvent = msg.event;
  const messagePrefix = displayPrefix(prefix, event, msg.historyId);
  if (msg.historyRef) {
    const clearStreaming = (event.kind === "text" && event.role === "assistant") || event.kind === "done";
    // Still advance the history cursor and completion state without adding prose.
    return { ...state,
      ...(event.kind === "done" && event.turns != null ? { turns: event.turns } : {}),
      ...(clearStreaming ? { streamingText: "", streamingBlockIndex: null } : {}) };
  }

  // ── Streaming deltas ──
  if (isStreamingEvent(event)) {
    // Drop stream events that belong to a sub-agent (Agent/Task tool).
    // Their deltas would otherwise interleave with the parent session's
    // streaming preview because they share the same sessionKey.
    if (extractParentId(event) !== null) {
      return state;
    }

    const delta = extractStreamDelta(event);
    if (delta !== null) {
      // Block boundary: a delta arrived for a different content block.
      // Reset the buffer to this block's text rather than concatenating.
      if (state.streamingBlockIndex !== delta.index) {
        return {
          ...state,
          streamingText: delta.text,
          streamingBlockIndex: delta.index,
        };
      }
      return {
        ...state,
        streamingText: (state.streamingText ?? "") + delta.text,
      };
    }
    if (isStreamEnd(event) && (state.streamingText || state.streamingBlockIndex !== null)) {
      return { ...state, streamingText: "", streamingBlockIndex: null };
    }
    return state;
  }

  // ── Usage event: replace totalCost ──
  if (event.kind === "usage") {
    if (event.costUSD != null) {
      return { ...state, totalCost: event.costUSD };
    }
    return state;
  }

  // ── Done event: capture turns, produce result/error message ──
  if (event.kind === "done") {
    const produced = normalizedToDisplayMessages(event, messagePrefix);
    const next: SessionStreamState = {
      ...state,
      streamingText: "",
      streamingBlockIndex: null,
    };
    if (event.turns != null) next.turns = event.turns;

    if (produced.length > 0) {
      const collapse = collapseAssistantResultDup(state.messages, produced, event);
      let nextMessages = state.messages;
      if (collapse.dropAssistantIdx >= 0) {
        nextMessages = [
          ...nextMessages.slice(0, collapse.dropAssistantIdx),
          ...nextMessages.slice(collapse.dropAssistantIdx + 1),
        ];
      }
      if (collapse.appended.length > 0) {
        const existing = new Set(nextMessages.map((m) => m.id));
        const dedup = collapse.appended.filter((m) => !existing.has(m.id));
        if (dedup.length > 0) {
          nextMessages = [...nextMessages, ...dedup];
        }
      }
      next.messages = nextMessages;
    }
    return next;
  }

  const withChangedPaths = retainChangedPaths(state.messages, event, prefix);
  if (withChangedPaths !== state.messages) return { ...state, messages: withChangedPaths };

  // ── Complete messages (text, thinking, tool_call, tool_progress) ──
  const produced = normalizedToDisplayMessages(event, messagePrefix);
  const collapse = collapseAssistantResultDup(state.messages, produced, event);

  // No new messages and no field changes → bail with same reference,
  // unless we still need to clear stale assistant preview on complete text.
  if (collapse.appended.length === 0 && collapse.dropAssistantIdx < 0) {
    if (event.kind === "text" && event.role === "assistant") {
      if (state.streamingText || state.streamingBlockIndex !== null) {
        return { ...state, streamingText: "", streamingBlockIndex: null };
      }
    }
    return state;
  }

  let nextMessages = state.messages;
  if (collapse.dropAssistantIdx >= 0) {
    nextMessages = [
      ...nextMessages.slice(0, collapse.dropAssistantIdx),
      ...nextMessages.slice(collapse.dropAssistantIdx + 1),
    ];
  }
  if (collapse.appended.length > 0) {
    const existing = new Set(nextMessages.map((m) => m.id));
    const dedup = collapse.appended.filter((m) => !existing.has(m.id));
    if (dedup.length > 0) {
      nextMessages = [...nextMessages, ...dedup];
    } else if (nextMessages === state.messages && collapse.dropAssistantIdx < 0) {
      // Nothing new and no drop — bail.
      if (event.kind === "text" && event.role === "assistant") {
        if (state.streamingText || state.streamingBlockIndex !== null) {
          return { ...state, streamingText: "", streamingBlockIndex: null };
        }
      }
      return state;
    }
  }

  const next: SessionStreamState = { ...state, messages: nextMessages };
  // Clear the assistant preview when complete text arrives.
  if (event.kind === "text" && event.role === "assistant") {
    next.streamingText = "";
    next.streamingBlockIndex = null;
  }
  return next;
}

/** Codex supplies changed paths on completion, after the displayed tool call. */
function retainChangedPaths(messages: DisplayMessage[], event: NormalizedEvent, prefix: string): DisplayMessage[] {
  if (event.kind !== "tool_result" || event.isError || !event.output || typeof event.output !== "object") return messages;
  const changes = (event.output as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return messages;
  const index = messages.findIndex(m => m.id === `${prefix}-call-${event.callId}` && m.toolName === "codex_file_change");
  if (index < 0) return messages;
  const message = messages[index]!;
  if (JSON.stringify(message.toolInput?.["changes"]) === JSON.stringify(changes)) return messages;
  const next = [...messages];
  next[index] = { ...message, toolInput: { ...message.toolInput, changes } };
  return next;
}

// ── session_status / session_error ──────────────────────

function reduceSessionStatus(
  state: SessionStreamState,
  msg: Extract<ServerMessage, { type: "session_status" }>,
): SessionStreamState {
  if (msg.sessionKey !== state.sessionKey) return state;
  const next = msg.status as SessionStreamStatus;
  if (next === state.status) return state;
  return { ...state, status: next };
}

function reduceSessionError(
  state: SessionStreamState,
  msg: Extract<ServerMessage, { type: "session_error" }>,
): SessionStreamState {
  if (msg.sessionKey !== state.sessionKey) return state;
  return {
    ...state,
    status: "error",
    error: msg.error,
    fullError: msg.fullError ?? msg.error,
  };
}

// ── Helpers ──────────────────────────────────────────────

/**
 * The SDK sends both the final assistant text and the `done` envelope
 * carrying the same content. Today's UI only wants the green result bubble.
 *
 * If the incoming event is a `done` with a result and the most recent
 * assistant message in `existing` has matching content (after stripping
 * `<!--task-name:...-->` markers), report which assistant index to drop.
 */
function collapseAssistantResultDup(
  existing: ReadonlyArray<DisplayMessage>,
  produced: ReadonlyArray<DisplayMessage>,
  event: NormalizedEvent,
): { appended: ReadonlyArray<DisplayMessage>; dropAssistantIdx: number } {
  if (event.kind !== "done") {
    return { appended: produced, dropAssistantIdx: -1 };
  }
  const resultMsg = produced.find((m) => m.role === "result");
  if (!resultMsg) {
    return { appended: produced, dropAssistantIdx: -1 };
  }
  const normalized = stripTaskNameMarker(resultMsg.content).trim();
  for (let i = existing.length - 1; i >= 0; i--) {
    const m = existing[i];
    if (m && m.role === "assistant") {
      if (stripTaskNameMarker(m.content).trim() === normalized) {
        return { appended: produced, dropAssistantIdx: i };
      }
      // Most recent assistant didn't match — don't keep walking.
      return { appended: produced, dropAssistantIdx: -1 };
    }
  }
  return { appended: produced, dropAssistantIdx: -1 };
}

function stripTaskNameMarker(s: string): string {
  return s.replace(/<!--task-name:.+?-->\s*/g, "");
}

/**
 * Re-insert optimistic user turns that a reducer output dropped.
 *
 * Most user messages exist first as client-side optimistic appends (see
 * LeaderNode.handleSend / MinionNode.startTask). Activity-owned canonical
 * prompts are server-persisted instead because no canvas node owns their
 * local state. Two paths can still lose optimistic messages:
 *
 *   1. **sync_response rebuild** — {@link reduceSyncResponse} reconstructs the
 *      feed purely from buffered sdk events. Older/optimistic user turns are
 *      absent there, so replacing `messages` wholesale would drop them on the
 *      next reconnect or refocus sync.
 *   2. **stale-snapshot race** — an inbound event reduced against a feed
 *      snapshot taken *before* the latest optimistic append drops that append
 *      when the caller overwrites `messages` with the reducer output.
 *
 * This helper takes the caller's authoritative `prev` feed (which holds the
 * optimistic user turns) and the reducer's `next` feed, and re-inserts any
 * `user` message missing from `next` at the position it held in `prev` —
 * immediately after its nearest surviving predecessor. Marked placeholders
 * are then replaced by matching persisted user turns. When neither operation
 * changes the feed, it returns `next` unchanged to preserve reference equality.
 */
export function preserveOptimisticUserMessages(
  prev: ReadonlyArray<DisplayMessage>,
  next: ReadonlyArray<DisplayMessage>,
  optimisticIds?: ReadonlySet<string>,
): DisplayMessage[] {
  const nextIds = new Set(next.map((m) => m.id));
  const missing: DisplayMessage[] = [];
  for (const m of prev) {
    if (m.role === "user" && !nextIds.has(m.id)) missing.push(m);
  }
  if (missing.length === 0) return collapseOptimisticUserEchoes(next, optimisticIds);

  const result = [...next];
  for (const u of missing) {
    const idxInPrev = prev.indexOf(u);
    // Nearest preceding message in `prev` that survives in `result` becomes
    // the anchor; the missing turn is spliced in right after it. Earlier
    // re-inserted turns are already in `result`, so a run of consecutive
    // missing user turns keeps its relative order.
    let anchorIdx = -1;
    for (let i = idxInPrev - 1; i >= 0; i--) {
      const p = prev[i];
      if (!p) continue;
      const at = result.findIndex((r) => r.id === p.id);
      if (at >= 0) {
        anchorIdx = at;
        break;
      }
    }
    if (anchorIdx < 0) {
      result.unshift(u);
    } else {
      result.splice(anchorIdx + 1, 0, u);
    }
  }
  return collapseOptimisticUserEchoes(result, optimisticIds);
}

/** Match placeholders one-to-one within a turn, preserving repeated requests. */
function collapseOptimisticUserEchoes(
  messages: ReadonlyArray<DisplayMessage>,
  optimisticIds?: ReadonlySet<string>,
): DisplayMessage[] {
  // Delivery receipts identify local bubbles saved before the optimistic flag
  // was added to the follow-up/new-iteration path.
  const isOptimistic = (message: DisplayMessage) => message.optimistic || optimisticIds?.has(message.id);
  const replaced = new Set<number>();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role !== "user" || isOptimistic(message)) continue;
    for (let j = i - 1; j >= 0; j--) {
      const candidate = messages[j]!;
      if (candidate.role !== "user" && candidate.role !== "system") break;
      if (candidate.role === "user" && isOptimistic(candidate)
        && candidate.content === message.content && !replaced.has(j)) {
        replaced.add(j);
        break;
      }
    }
  }
  return replaced.size ? messages.filter((_, index) => !replaced.has(index))
    : messages as DisplayMessage[];
}

/** Convenience: a fresh empty state. */
export function emptySessionStreamState(
  sessionKey: string | null = null,
): SessionStreamState {
  return {
    sessionKey,
    status: "disconnected",
    messages: [],
    streamingText: "",
    streamingBlockIndex: null,
    ...EMPTY_THINKING_STREAM,
    totalCost: 0,
    turns: 0,
    error: null,
    fullError: null,
  };
}
