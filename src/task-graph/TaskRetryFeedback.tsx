import type { TaskGraphNodeView } from "./types.ts";
import type { TaskRetryReceipt } from "./use-task-retry-receipts.ts";

export function TaskRetryFeedback({ node, receipt, onRefresh }: {
  node: TaskGraphNodeView;
  receipt: TaskRetryReceipt | undefined;
  onRefresh: (() => void) | undefined;
}) {
  return <>
    <p className="tg-retry-feedback" role="status">{receipt?.pending ? receipt.accepted ? "Retry accepted · waiting to start" : "Retry requested…" : node.currentAttempt
      ? `Attempt ${node.currentAttempt.number} ${node.currentAttempt.state}` : "No current attempt"}</p>
    {receipt?.error && <div className="tg-retry-feedback tg-retry-feedback--error" role="alert">
      <span>{receipt.error}</span>
      {onRefresh && <button className="tg-button" type="button" onClick={onRefresh}>Refresh task state</button>}
    </div>}
  </>;
}
