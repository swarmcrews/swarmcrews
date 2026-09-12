import { useCallback, useEffect, useState } from "react";
import type { SocketSubscribeLike } from "../use-socket.ts";
import { useTaskGraphView } from "./use-task-graph-view.ts";
import { useTaskGraphHistory } from "./use-task-graph-history.ts";

export function useLeaderTaskGraphController(input: {
  workItemId: string | null;
  socketSend?: ((data: unknown) => void) | undefined;
  socketSubscribe?: SocketSubscribeLike;
}) {
  const [open, setOpen] = useState(false);
  const [initialSelectedNodeId, setInitialSelectedNodeId] = useState<string | null>(null);
  const projection = useTaskGraphView({ workItemId: input.workItemId,
    send: input.socketSend, subscribe: input.socketSubscribe });
  const history = useTaskGraphHistory({ workItemId: input.workItemId,
    currentRunId: projection.snapshot?.graphRunId ?? null,
    send: input.socketSend, subscribe: input.socketSubscribe });
  useEffect(() => {
    setOpen(false);
    setInitialSelectedNodeId(null);
  }, [input.workItemId]);
  const openInspector = useCallback(() => {
    history.selectRun(null);
    setInitialSelectedNodeId(null);
    setOpen(true);
  }, [history.selectRun]);
  const inspectRun = useCallback((runId: string | null) => {
    history.selectRun(runId);
    setInitialSelectedNodeId(null);
    setOpen(true);
  }, [history.selectRun]);
  const inspectNode = useCallback((nodeId: string) => {
    history.selectRun(null);
    setInitialSelectedNodeId(nodeId);
    setOpen(true);
  }, [history.selectRun]);
  const closeInspector = useCallback(() => setOpen(false), []);
  return { ...projection, history, open, openInspector, closeInspector, initialSelectedNodeId, inspectNode, inspectRun };
}

export type LeaderTaskGraphController = ReturnType<typeof useLeaderTaskGraphController>;
