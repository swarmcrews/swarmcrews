import { useCallback, useEffect, useRef, useState } from "react";
import { taskGraphHistoryViewSchema, taskGraphResponseEnvelopeSchema,
  type TaskGraphRunSummary, type TaskGraphSnapshotView } from "../../shared/task-graph-view-contracts.ts";
import { workItemTopic } from "../../shared/ws-envelope.ts";
import { randomUuid } from "../random-id.ts";
import { subscribeSocketTopic, type SocketSubscribeLike } from "../use-socket.ts";

/** Historical reads use correlated replies, never the live snapshot stream. */
export function useTaskGraphHistory({ workItemId, currentRunId, send, subscribe }: {
  workItemId: string | null;
  currentRunId: string | null;
  send?: ((data: unknown) => void) | undefined;
  subscribe?: SocketSubscribeLike;
}) {
  const [runs, setRuns] = useState<TaskGraphRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<TaskGraphSnapshotView | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  const request = useCallback((runId: string | null) => {
    if (!workItemId || !send) return;
    const requestId = randomUuid();
    pendingRef.current = requestId;
    setPendingRequestId(requestId);
    setError(null);
    try {
      send({ type: "get_task_graph_history", requestId, workItemId, ...(runId ? { runId } : {}) });
    } catch {
      pendingRef.current = null;
      setPendingRequestId(null);
      setError("Could not load graph history.");
    }
  }, [send, workItemId]);

  useEffect(() => {
    selectedRef.current = null;
    pendingRef.current = null;
    setSelectedRunId(null);
    setSnapshot(null);
    setRuns([]);
    setError(null);
    setPendingRequestId(null);
    if (!workItemId) return;
    return subscribeSocketTopic(subscribe, workItemTopic(workItemId), raw => {
      if ((raw as { type?: string })?.type === "socket_reconnected") {
        request(selectedRef.current);
        return;
      }
      const parsed = taskGraphResponseEnvelopeSchema.safeParse(raw);
      if (!parsed.success) return;
      const response = parsed.data;
      if (response.topic !== workItemTopic(workItemId) || response.command !== "get_task_graph_history"
        || !pendingRef.current || response.requestId !== pendingRef.current) return;
      pendingRef.current = null;
      setPendingRequestId(null);
      const result = response.success ? taskGraphHistoryViewSchema.safeParse(response.result) : null;
      if (!result?.success || (selectedRef.current && result.data.snapshot?.graphRunId !== selectedRef.current)) {
        setError("Could not load graph history.");
        return;
      }
      setRuns(result.data.runs);
      setSnapshot(selectedRef.current ? result.data.snapshot : null);
    });
  }, [request, subscribe, workItemId]);

  useEffect(() => { request(selectedRef.current); }, [request, subscribe, currentRunId]);

  // A missing response must leave an actionable retry, not a permanent spinner.
  useEffect(() => {
    if (!pendingRequestId) return;
    const timer = window.setTimeout(() => {
      pendingRef.current = null;
      setPendingRequestId(null);
      setError("Graph history took too long to load.");
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [pendingRequestId]);

  const selectRun = useCallback((runId: string | null) => {
    selectedRef.current = runId;
    setSelectedRunId(runId);
    setSnapshot(null);
    request(runId);
  }, [request]);
  const refresh = useCallback(() => request(selectedRef.current), [request]);
  return { runs, selectedRunId, snapshot, loading: pendingRequestId !== null, error, selectRun, refresh };
}

export type TaskGraphHistory = ReturnType<typeof useTaskGraphHistory>;
