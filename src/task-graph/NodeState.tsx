import type { TaskGraphNodeView } from "./types.ts";

export function NodeState({ node, compact = false }: { node: TaskGraphNodeView; compact?: boolean }) {
  const attempt = node.currentAttempt?.state ?? "none";
  const waiting = node.logicalState === "pending" && node.blocker?.category === "delay";
  const release = waiting && node.scheduledReleaseAt ? new Date(node.scheduledReleaseAt).toLocaleString() : null;
  const description = `Logical ${node.logicalState}; attempt ${attempt}; verification ${node.verification.state}${node.blocker && node.blocker.category !== "none" ? `; blocker ${node.blocker.category}` : ""}${release ? `; waiting until ${release}` : ""}`;
  return (
    <span
      className={`tg-node-state${compact ? " tg-node-state--compact" : ""} tg-logical--${node.logicalState} tg-attempt--${attempt}`}
      aria-label={description}
      title={description}
    >
      <span className="tg-node-state__fill">{compact ? "" : waiting ? "Waiting" : node.logicalState}</span>
      <span className={`tg-verification tg-verification--${node.verification.state}`} title={`Verification: ${node.verification.state}`} aria-hidden="true">
        {node.verification.state === "passed" ? "✓" : node.verification.state === "waived" ? "◇" : "♢"}
      </span>
      {release && !compact && <time dateTime={node.scheduledReleaseAt}>Release {release}</time>}
      {node.blocker && node.blocker.category !== "none" && <span className="tg-blocker">{waiting && compact ? "Waiting" : node.blocker.category}</span>}
    </span>
  );
}
