import { useEffect, useRef, useState, type UIEvent } from "react";
import { getVirtualRange, whyNotRunning, WORK_QUEUE_ROW_HEIGHT } from "./model.ts";
import { NodeState } from "./NodeState.tsx";
import type { TaskGraphNodeView } from "./types.ts";

export function WorkQueue({ nodes, onSelect, onClearFilter }: { nodes: TaskGraphNodeView[]; onSelect: (id: string) => void; onClearFilter?: () => void }) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(348);
  const queueRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = queueRef.current;
    if (!element) return;
    const update = () => setViewportHeight(Math.max(WORK_QUEUE_ROW_HEIGHT, element.clientHeight));
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  useEffect(() => {
    const element = queueRef.current;
    if (!element) return;
    const maxScroll = Math.max(0, nodes.length * WORK_QUEUE_ROW_HEIGHT - viewportHeight);
    if (element.scrollTop > maxScroll) element.scrollTop = maxScroll;
    setScrollTop(element.scrollTop);
  }, [nodes.length, viewportHeight]);
  const range = getVirtualRange(nodes.length, scrollTop, viewportHeight);
  const visible = nodes.slice(range.start, range.end);
  const onScroll = (event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop);
  return (
    <div ref={queueRef} className="tg-queue" role="region" aria-label="Windowed work queue" onScroll={onScroll}>
      {nodes.length === 0 ? <div className="tg-queue__empty"><strong>{onClearFilter ? "No tasks match this filter." : "No tasks in this graph yet."}</strong>{onClearFilter ? <button type="button" className="tg-button" onClick={onClearFilter}>Clear filter</button> : null}</div> : null}
      <div style={{ height: range.totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${range.offset}px)` }}>
          {visible.map((node) => (
            <button key={node.id} type="button" className="tg-queue-row" style={{ height: WORK_QUEUE_ROW_HEIGHT }} onClick={() => onSelect(node.id)}>
              <NodeState node={node} compact />
              <span className="tg-queue-row__main"><strong>{node.title}</strong><small>{whyNotRunning(node)}</small></span>
              <span className="tg-queue-row__meta">P{node.priority} · age {formatAge(node.queueAgeMs)}<small>{node.currentAttempt?.executor ?? "unassigned"}</small></span>
              <span className="tg-queue-row__meta">{node.currentAttempt ? `#${node.currentAttempt.number} ${node.currentAttempt.state}` : "no attempt"}<small>{node.backoffUntil ? `backoff until ${new Date(node.backoffUntil).toLocaleTimeString()}` : `$${node.costUsd.toFixed(2)}`}</small></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatAge(ms?: number) {
  if (ms == null) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}
