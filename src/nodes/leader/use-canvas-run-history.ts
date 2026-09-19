import { useCallback, useEffect, useMemo, useState } from "react";
import { initialWorkItemClientState, reduceWorkItems } from "../../use-work-items.ts";
import { useWorkItemHistory } from "../../use-work-item-history.ts";
import type { SessionStreamState } from "../../session-stream.ts";
import type { CanvasPendingMessages } from "../../canvas-run-stream.ts";
import { subscribeSocketTopic, type ServerMessage, type SocketSubscribe,
  type SocketSubscribeLike } from "../../use-socket.ts";

/** Keep historical replay separate from persisted/live node messages. */
export function useCanvasRunHistory(input: {
  workItemId: string | null;
  socketSend: ((data: unknown) => void) | undefined;
  socketSubscribe: SocketSubscribeLike;
  currentStream: Pick<SessionStreamState, "sessionKey" | "messages" | "historyHighWater"> & CanvasPendingMessages;
}) {
  const { workItemId, socketSend, socketSubscribe } = input;
  const [ledger, setLedger] = useState(initialWorkItemClientState);
  useEffect(() => { setLedger(initialWorkItemClientState); }, [workItemId]);
  // Canvas also supports legacy one-argument subscriptions.
  const subscribe = useMemo(() => socketSubscribe ? Object.assign(
    ((topic: string, listener: (message: unknown) => void) =>
      subscribeSocketTopic(socketSubscribe, topic, listener) ?? (() => {})) as SocketSubscribe,
    { supportsTopics: true as const },
  ) : undefined, [socketSubscribe]);

  useEffect(() => {
    if (!workItemId) return;
    return subscribeSocketTopic(socketSubscribe, "*", (raw) => {
      const message = raw as ServerMessage;
      if ((message.type === "work_item_run_created" || message.type === "work_item_run_sealed")
        && message.workItemId === workItemId) {
        setLedger((current) => reduceWorkItems(current, message));
      } else if (message.type === "work_item_response" && message.success
        && message.command === "get_work_item_runs"
        && (message.result as { workItemId?: string } | undefined)?.workItemId === workItemId) {
        setLedger((current) => reduceWorkItems(current, message));
      }
    });
  }, [socketSubscribe, workItemId]);
  const loadRuns = useCallback((cursor?: string) => {
    if (workItemId) socketSend?.({ type: "get_work_item_runs", workItemId, cursor, limit: 100 });
  }, [socketSend, workItemId]);
  const runs = useMemo(() => (workItemId ? ledger.runs[workItemId] ?? [] : [])
    .filter((run) => run.runKind === "primary"), [ledger.runs, workItemId]);
  const { messages, messageDelivery } = input.currentStream;
  const historyMessages = useMemo(() => messages.filter((message) => {
    const state = messageDelivery?.[message.id]?.state;
    // Pending submissions move with the live stream when a new run starts.
    // They stay visible there, but must not be cached under the outgoing run.
    return message.role !== "user"
      || (state !== "sending" && state !== "unconfirmed" && state !== "failed");
  }), [messages, messageDelivery]);
  return useWorkItemHistory({
    currentStream: { ...input.currentStream, messages: historyMessages },
    workItemId, runs, runNextCursor: workItemId ? ledger.runNextCursor[workItemId] : undefined,
    ...(socketSend ? { socketSend, onLoadRuns: loadRuns } : {}),
    ...(subscribe ? { socketSubscribe: subscribe } : {}),
  });
}
