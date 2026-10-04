import { useCallback, useEffect, useRef, useState } from "react";
import { lineageTopic } from "../shared/ws-envelope.ts";
import { isReviewDiff, type ReviewDiff } from "../shared/review-diff.ts";
import { randomUuid } from "./random-id.ts";
import { subscribeSocketTopic, type ServerMessage, type SocketSubscribeLike } from "./use-socket.ts";

/** Durable read transport: no dependency on a registered/current session. */
export function useIntegrationReviewDiff(lineageId: string, contributionId: string | undefined, revisionKey: string,
  send: (data: unknown) => void, subscribe?: SocketSubscribeLike) {
  const key = JSON.stringify([lineageId, contributionId]);
  const owner = useRef(key);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [diff, setDiff] = useState<ReviewDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = null;
    if (!lineageId) { setLoading(false); return; }
    if (!subscribe) { setLoading(false); setError("Changes unavailable: connection required."); return; }
    const requestId = randomUuid();
    pending.current = requestId;
    setLoading(true); setError(null);
    timer.current = setTimeout(() => {
      if (pending.current !== requestId) return;
      pending.current = null; setLoading(false); setError("Still waiting for evidence. Retry to request the latest revision.");
    }, 15000);
    try { send({ type: "get_integration_review_diff", lineageId, ...(contributionId ? { contributionId } : {}), requestId }); }
    catch (cause) {
      clearTimeout(timer.current); pending.current = null; setLoading(false);
      setError(cause instanceof Error ? cause.message : "Couldn’t load evidence");
    }
  }, [lineageId, contributionId, send, subscribe]);
  useEffect(() => {
    if (owner.current !== key) { owner.current = key; setDiff(null); setError(null); }
    if (!lineageId) return;
    const unsubscribe = subscribeSocketTopic(subscribe, lineageTopic(lineageId), value => {
      const raw = value as ServerMessage;
      if (raw.type === "socket_reconnected") { refresh(); return; }
      if (raw.type !== "integration_review_diff_response" || raw.lineageId !== lineageId
        || (raw.contributionId ?? undefined) !== contributionId || !pending.current || raw.requestId !== pending.current) return;
      clearTimeout(timer.current); pending.current = null; setLoading(false);
      if (!raw.success || !isReviewDiff(raw.diff)) {
        setError(typeof raw.error === "string" ? raw.error : "Evidence response was incomplete or invalid."); return;
      }
      const snapshot = raw.diff.snapshot;
      if (!snapshot || snapshot.lineageId !== lineageId || (contributionId
        ? snapshot.contributionBinding !== "bound" || snapshot.contributionId !== contributionId
        : snapshot.contributionBinding !== "lineage")) {
        setError("Evidence identity does not match this review."); return;
      }
      setDiff(raw.diff); setError(null);
    });
    refresh();
    return () => { unsubscribe?.(); clearTimeout(timer.current); pending.current = null; };
  }, [key, lineageId, contributionId, revisionKey, subscribe, refresh]);
  return { diff: owner.current === key ? diff : null, loading, error: owner.current === key ? error : null, refresh };
}
