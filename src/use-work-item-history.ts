import { useEffect, useMemo, useRef, useState } from "react";

import type { WorkItemRunSnapshot } from "../shared/work-item-contracts.ts";
import {
  emptySessionStreamState,
  sessionStreamReducer,
  type SessionStreamState,
} from "./session-stream.ts";
import type { ServerMessage, SocketSubscribe } from "./use-socket.ts";

export interface WorkItemHistoryState {
  orderedRuns: WorkItemRunSnapshot[];
  streams: Record<string, SessionStreamState>;
  loading: boolean;
}

/**
 * Rebuild every run transcript using the same bounded sync replay as a normal
 * session inspector. Run metadata remains owned by the canonical work-item
 * ledger; this hook only joins those immutable run keys to their session logs.
 */
export function useWorkItemHistory(input: {
  workItemId: string | null | undefined;
  runs: readonly WorkItemRunSnapshot[];
  runNextCursor: string | null | undefined;
  onLoadRuns?: (cursor?: string) => void;
  socketSend?: (data: unknown) => void;
  socketSubscribe?: SocketSubscribe;
  /** Preserve the transcript already displayed while its durable replay loads. */
  currentStream?: Pick<SessionStreamState, "sessionKey" | "messages" | "historyHighWater">;
}): WorkItemHistoryState {
  const { workItemId, runs, runNextCursor, onLoadRuns, socketSend, socketSubscribe } = input;
  const currentRunKey = input.currentStream?.sessionKey;
  const currentMessages = input.currentStream?.messages;
  const currentHighWater = input.currentStream?.historyHighWater;
  const [streams, setStreams] = useState<Record<string, SessionStreamState>>({});
  const requestedPages = useRef(new Set<string>());
  const requestedRuns = useRef(new Set<string>());
  const loadRunsRef = useRef(onLoadRuns);
  loadRunsRef.current = onLoadRuns;
  const orderedRuns = useMemo(
    () => [...runs].sort((a, b) => a.startedAt - b.startedAt || a.runKey.localeCompare(b.runKey)),
    [runs],
  );
  const runKeySignature = orderedRuns.map((run) => run.runKey).join("\u0000");

  useEffect(() => {
    requestedPages.current.clear();
    requestedRuns.current.clear();
    setStreams({});
  }, [workItemId]);

  useEffect(() => {
    if (!workItemId || !currentRunKey || !currentMessages?.length) return;
    // The canvas replaces its live state when the run changes. Keep the last
    // displayed messages under their original run key, including messages
    // restored before this hook subscribed or before the ledger arrived.
    setStreams((current) => {
      const previous = current[currentRunKey] ?? emptySessionStreamState(currentRunKey);
      if (previous.messages === currentMessages) return current;
      return { ...current, [currentRunKey]: { ...previous,
        sessionKey: currentRunKey, messages: currentMessages,
        historyHighWater: currentHighWater ?? previous.historyHighWater,
      } };
    });
  }, [workItemId, currentRunKey, currentMessages, currentHighWater]);

  useEffect(() => {
    // Also reset requests when the caller replaces the socket subscription.
    // Normal reconnects retain its identity and are handled below.
    requestedPages.current.clear();
    requestedRuns.current.clear();
  }, [socketSubscribe]);

  useEffect(() => {
    if (!workItemId || !onLoadRuns) return;
    // `undefined` means no ledger page has been requested yet; `null` means
    // the server confirmed the final page. A live run event may populate
    // `runs` before the first ledger response, so runs.length cannot decide
    // whether history is complete.
    const cursorKey = runNextCursor === undefined ? "__first__" : runNextCursor;
    if (!cursorKey || requestedPages.current.has(cursorKey)) return;
    requestedPages.current.add(cursorKey);
    onLoadRuns(cursorKey === "__first__" ? undefined : cursorKey);
  }, [onLoadRuns, runNextCursor, socketSubscribe, workItemId]);

  useEffect(() => {
    if (!workItemId || !socketSubscribe) return;
    const runKeys = new Set(runKeySignature ? runKeySignature.split("\u0000") : []);
    const syncRuns = () => {
      if (!socketSend) return;
      for (const runKey of runKeys) {
        if (requestedRuns.current.has(runKey)) continue;
        requestedRuns.current.add(runKey);
        socketSend({ type: "sync_session", sessionKey: runKey });
      }
    };
    const unsubscribe = socketSubscribe("*", (raw: unknown) => {
      const msg = raw as ServerMessage;
      if (msg.type === "socket_reconnected") {
        // useSocket keeps subscribe stable across reconnects. Refresh from
        // page one even when the cached ledger was complete: runs and replay
        // responses may have been missed while the connection was down.
        requestedPages.current.clear();
        requestedRuns.current.clear();
        if (loadRunsRef.current) {
          requestedPages.current.add("__first__");
          loadRunsRef.current(undefined);
        }
        syncRuns();
        return;
      }
      const sessionKey = "sessionKey" in msg && typeof msg.sessionKey === "string"
        ? msg.sessionKey
        : null;
      if (!sessionKey || !runKeys.has(sessionKey)) return;
      setStreams((current) => {
        const previous = current[sessionKey] ?? emptySessionStreamState(sessionKey);
        const next = sessionStreamReducer(previous, msg, `work-history-${sessionKey}`);
        return next === previous ? current : { ...current, [sessionKey]: next };
      });
    });
    syncRuns();
    return unsubscribe;
  }, [runKeySignature, socketSend, socketSubscribe, workItemId]);

  return {
    orderedRuns,
    streams,
    loading: Boolean(workItemId && onLoadRuns && runNextCursor !== null),
  };
}
