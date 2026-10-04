import { useCallback, useEffect, useRef, useState } from "react";
import { sessionTopic } from "../shared/ws-envelope.ts";
import { isReviewDiff, type ReviewDiff } from "../shared/review-diff.ts";
import { randomUuid } from "./random-id.ts";
import { subscribeSocketTopic, type ServerMessage, type SocketSubscribeLike } from "./use-socket.ts";

type Diff = ReviewDiff;

/** Only the latest requested diff may replace the retained review. */
export function useReviewDiff(sessionKey: string, send: ((data: unknown) => void) | undefined, subscribe: SocketSubscribeLike) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const owner = useRef(sessionKey);
  const pending = useRef<string | null>(null);
  const canAutoRefresh = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useCallback(() => {
    canAutoRefresh.current = false;
    clearTimeout(timer.current);
    if (!send || !subscribe) { pending.current = null; setLoading(false); setError("Changes unavailable: connection required."); return; }
    const requestId = randomUuid();
    pending.current = requestId;
    setLoading(true);
    setError(null);
    timer.current = setTimeout(() => {
      if (pending.current !== requestId) return;
      pending.current = null;
      setLoading(false);
      setError("Still waiting for changes. Retry to request the latest diff.");
    }, 15000);
    try { send({ type: "get_worktree_diff", sessionKey, requestId }); }
    catch (cause) {
      clearTimeout(timer.current);
      pending.current = null;
      setLoading(false);
      setError(cause instanceof Error ? cause.message : "Couldn’t load changes");
    }
  }, [send, sessionKey, subscribe]);

  useEffect(() => {
    if (owner.current !== sessionKey) {
      owner.current = sessionKey;
      setDiff(null);
      setError(null);
      setLoadedAt(null);
    }
    if (!sessionKey) return;
    const unsubscribe = subscribeSocketTopic(subscribe, sessionTopic(sessionKey), raw => {
      const message = raw as ServerMessage;
      if (message.type === "socket_reconnected") { refresh(); return; }
      if (message.type !== "control_response" || message.command !== "get_worktree_diff"
        || message.sessionKey !== sessionKey || !pending.current || message.requestId !== pending.current) return;
      clearTimeout(timer.current);
      pending.current = null;
      setLoading(false);
      if (message.success && isReviewDiff(message["diff"])) {
        if (message["diff"].snapshot?.runKey && message["diff"].snapshot.runKey !== sessionKey) {
          setError("Diff run identity does not match this review."); return;
        }
        canAutoRefresh.current = true;
        setDiff(message["diff"]);
        setLoadedAt(Date.now());
        setError(null);
      } else setError(message.error ?? "Diff response was incomplete or invalid.");
    });
    refresh();
    const poll = setInterval(() => {
      if (canAutoRefresh.current && !pending.current && document.visibilityState !== "hidden") refresh();
    }, 5000);
    return () => { unsubscribe?.(); clearInterval(poll); clearTimeout(timer.current); pending.current = null; };
  }, [refresh, sessionKey, subscribe]);
  return { diff: owner.current === sessionKey ? diff : null, loading, error: owner.current === sessionKey ? error : null, loadedAt: owner.current === sessionKey ? loadedAt : null, refresh };
}
