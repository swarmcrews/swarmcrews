import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  recentRuns: WorkItemRunSnapshot[];
  olderRuns: WorkItemRunSnapshot[];
  hasMore: boolean;
  loadMore: () => void;
  loadRun: (runKey: string) => void;
  releaseRun: (runKey: string) => void;
  runStatus: Record<string, "loading" | "ready" | "unavailable">;
}

/**
 * Rebuild only recent primary runs and explicitly opened transcripts with bounded
 * sync replay. Run metadata remains owned by the canonical work-item
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
  currentRunKey?: string;
  currentStream?: Pick<SessionStreamState, "sessionKey" | "messages" | "historyHighWater">;
}): WorkItemHistoryState {
  const { workItemId, runs, runNextCursor, onLoadRuns, socketSend, socketSubscribe } = input;
  const currentRunKey = input.currentRunKey ?? input.currentStream?.sessionKey;
  const currentMessages = input.currentStream?.messages;
  const currentHighWater = input.currentStream?.historyHighWater;
  const [streams, setStreams] = useState<Record<string, SessionStreamState>>({});
  const [opened, setOpened] = useState<{ workItemId: typeof workItemId; keys: string[] }>({ workItemId, keys: [] });
  const [runStatus, setRunStatus] = useState<WorkItemHistoryState["runStatus"]>({});
  const [pendingPage, setPendingPage] = useState<string | null>(null);
  const requestedPages = useRef(new Set<string>());
  const requestedRuns = useRef(new Set<string>());
  const loadRunsRef = useRef(onLoadRuns);
  loadRunsRef.current = onLoadRuns;
  const orderedRuns = useMemo(
    () => [...runs].sort((a, b) => a.startedAt - b.startedAt || a.runKey.localeCompare(b.runKey)),
    [runs],
  );
  const primaryRuns = orderedRuns.filter((run) => run.runKind === "primary");
  // Reserve a slot for a current run whose ledger event has not arrived yet.
  const recentCount = currentRunKey && !primaryRuns.some((run) => run.runKey === currentRunKey) ? 2 : 3;
  const recentPrimary = primaryRuns.slice(-recentCount);
  const recentKeys = new Set(recentPrimary.map((run) => run.runKey));
  if (currentRunKey) recentKeys.add(currentRunKey);
  const recentRuns = orderedRuns.filter((run) => run.runKind === "primary"
    ? recentKeys.has(run.runKey) : Boolean(run.parentRunKey && recentKeys.has(run.parentRunKey)));
  const olderRuns = primaryRuns.filter((run) => !recentKeys.has(run.runKey)).reverse();
  const openedKeys = opened.workItemId === workItemId ? opened.keys : [];
  const runKeySignature = [...new Set([...recentPrimary.map((run) => run.runKey), ...openedKeys])].join("\u0000");
  const loadRun = useCallback((runKey: string) => {
    setOpened((current) => {
      const keys = current.workItemId === workItemId ? current.keys : [];
      return { workItemId, keys: [...keys, runKey] };
    });
  }, [workItemId]);
  const releaseRun = useCallback((runKey: string) => {
    setOpened((current) => {
      const index = current.keys.indexOf(runKey);
      return { ...current, keys: current.keys.filter((_, i) => i !== index) };
    });
  }, []);
  const loadMore = useCallback(() => {
    if (!workItemId || !onLoadRuns || !runNextCursor || requestedPages.current.has(runNextCursor)) return;
    requestedPages.current.add(runNextCursor);
    setPendingPage(runNextCursor);
    onLoadRuns(runNextCursor);
  }, [workItemId, onLoadRuns, runNextCursor]);

  useEffect(() => {
    requestedPages.current.clear();
    requestedRuns.current.clear();
    setStreams({});
    setRunStatus({});
    setOpened({ workItemId, keys: [] });
    setPendingPage(null);
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
    if (!workItemId || !onLoadRuns || (runNextCursor !== undefined && primaryRuns.length >= recentCount)) return;
    // `undefined` means no ledger page has been requested yet; `null` means
    // the server confirmed the final page. A live run event may populate
    // `runs` before the first ledger response, so runs.length cannot decide
    // whether history is complete.
    const cursorKey = runNextCursor === undefined ? "__first__" : runNextCursor;
    if (!cursorKey || requestedPages.current.has(cursorKey)) return;
    requestedPages.current.add(cursorKey);
    setPendingPage(cursorKey);
    onLoadRuns(cursorKey === "__first__" ? undefined : cursorKey);
  }, [onLoadRuns, runNextCursor, socketSubscribe, workItemId, primaryRuns.length, recentCount]);

  useEffect(() => {
    if (!workItemId || !socketSubscribe) return;
    const runKeys = new Set(runKeySignature ? runKeySignature.split("\u0000") : []);
    // Drop closed replay buffers and requests; browsing history must not retain
    // every transcript visited. The live canvas cache is preserved separately.
    for (const key of requestedRuns.current) {
      if (!runKeys.has(key)) requestedRuns.current.delete(key);
    }
    setStreams((current) => Object.fromEntries(Object.entries(current)
      .filter(([key]) => runKeys.has(key) || key === currentRunKey)));
    setRunStatus((current) => Object.fromEntries(Object.entries(current).filter(([key]) => runKeys.has(key))));
    const syncRuns = () => {
      if (!socketSend) return;
      for (const runKey of runKeys) {
        if (requestedRuns.current.has(runKey)) continue;
        requestedRuns.current.add(runKey);
        setRunStatus((current) => ({ ...current, [runKey]: "loading" }));
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
          setPendingPage("__first__");
          loadRunsRef.current(undefined);
        }
        syncRuns();
        return;
      }
      const sessionKey = "sessionKey" in msg && typeof msg.sessionKey === "string"
        ? msg.sessionKey
        : null;
      if (!sessionKey || !runKeys.has(sessionKey)) return;
      if (msg.type === "sync_response") {
        setRunStatus((current) => ({ ...current, [sessionKey]: msg.found ? "ready" : "unavailable" }));
      }
      setStreams((current) => {
        const previous = current[sessionKey] ?? emptySessionStreamState(sessionKey);
        const next = sessionStreamReducer(previous, msg, `work-history-${sessionKey}`);
        return next === previous ? current : { ...current, [sessionKey]: next };
      });
    });
    syncRuns();
    return unsubscribe;
  }, [runKeySignature, socketSend, socketSubscribe, workItemId, currentRunKey]);

  return {
    orderedRuns,
    streams,
    recentRuns, olderRuns, loadMore, loadRun, releaseRun, runStatus,
    hasMore: Boolean(onLoadRuns && runNextCursor),
    loading: Boolean(workItemId && onLoadRuns && (runNextCursor === undefined
      || (runNextCursor !== null && pendingPage === runNextCursor))),
  };
}
