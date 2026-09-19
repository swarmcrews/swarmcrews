import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { graphSignal } from "./graph-appearance.ts";
import { ModelLabel, modelLabel } from "./ModelLabel.tsx";
import { nodeIdsForPlanItem, projectTopology, whyNotRunning } from "./model.ts";
import { NodeState } from "./NodeState.tsx";
import { elapsedLabel, executionBounds, executionOrder, executionSegments, timestamp, timeTick } from "./waterfall-model.ts";
import type { GraphFilter, GraphPlanItem, TaskGraphSnapshotView } from "./types.ts";

const LABEL_WIDTH = 260;
const ROW_HEIGHT = 68;
const AXIS_HEIGHT = 36;
const TICK_WIDTH = 120;

export function Waterfall({ snapshot, filter, selectedNodeId, focusedPlanTaskId = null, plan = [], live = true, onSelect }: {
  snapshot: TaskGraphSnapshotView;
  filter: GraphFilter;
  selectedNodeId: string | null;
  focusedPlanTaskId?: string | null;
  plan?: readonly GraphPlanItem[];
  live?: boolean;
  onSelect: (id: string) => void;
}) {
  const canGrow = live && !["completed", "failed", "cancelled", "draft"].includes(snapshot.status)
    && snapshot.nodes.some((node) => node.logicalState === "pending" && node.currentAttempt?.state === "running"
      && timestamp(node.currentAttempt.startedAt) !== null && !node.currentAttempt.finishedAt);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!canGrow) return;
    const tick = () => { if (!document.hidden) setClock(Date.now()); };
    tick();
    const timer = window.setInterval(tick, 1_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [canGrow, snapshot.graphRunId]);
  const recordedAt = timestamp(snapshot.updatedAt) ?? clock;
  const now = canGrow ? Math.max(recordedAt, clock) : recordedAt;
  const bounds = executionBounds(snapshot, now);
  // Keep milliseconds per pixel fixed while running: bars grow, the scale does not chase them.
  const [tickMs, setTickMs] = useState(() => timeTick(bounds.duration));
  const projection = useMemo(() => projectTopology(snapshot, filter, selectedNodeId), [snapshot, filter, selectedNodeId]);
  const ordered = useMemo(() => executionOrder(snapshot), [snapshot]);
  const visibleIds = new Set(projection.nodes.map((node) => node.id));
  const rows = ordered.filter((node) => visibleIds.has(node.id));
  const rowIndex = new Map(rows.map((node, index) => [node.id, index]));
  const segments = new Map(rows.map((node) => [node.id, executionSegments(node, now)]));
  const focus = nodeIdsForPlanItem(snapshot.nodes, plan.find((item) => item.taskId === focusedPlanTaskId));
  const related = new Set(projection.edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId).flatMap((edge) => [edge.source, edge.target]));
  const tickCount = Math.max(6, Math.ceil(bounds.duration / tickMs) + 1);
  const plotWidth = tickCount * TICK_WIDTH;
  const width = LABEL_WIDTH + plotWidth + 28;
  const height = AXIS_HEIGHT + Math.max(1, rows.length) * ROW_HEIGHT;
  const xAt = (time: number) => LABEL_WIDTH + 16 + (time - bounds.start) / tickMs * TICK_WIDTH;
  const markerId = `tg-waterfall-${useId().replaceAll(":", "")}`;
  const running = canGrow;

  return <div className="tg-flow tg-waterfall tg-graph-visual" data-live={running} style={{ "--tg-waterfall-label-width": `${LABEL_WIDTH}px`, "--tg-waterfall-row-height": `${ROW_HEIGHT}px` } as CSSProperties} aria-label="Execution waterfall">
    <div className="tg-topology__notice">
      <span>{rows.length} tasks · {projection.edges.length} dependencies</span>
      <span>{running ? "Live execution" : "Recorded execution"} · Bars show attempt duration</span>
      {projection.hiddenNodeCount > 0 ? <span>{projection.hiddenNodeCount} nodes aggregated; not shown by the current limit or filter.</span> : null}
      {projection.hiddenEdgeCount > 0 ? <span>{projection.hiddenEdgeCount} dependencies not shown by the current limit or filter.</span> : null}
      {focusedPlanTaskId && !focus.size ? <span className="tg-notice-attention">Selected plan item has no exact runtime projection.</span> : null}
    </div>
    <div className="tg-flow-controls" role="group" aria-label="Waterfall time scale">
      <span className="tg-waterfall__scale" title="Elapsed time from the first recorded attempt">Elapsed · {elapsedLabel(tickMs)} / division</span>
      <button className="tg-button" aria-label="Zoom out time scale" disabled={tickMs >= 86_400_000} onClick={() => setTickMs((tick) => Math.min(86_400_000, tick * 2))}>−</button>
      <button className="tg-button" aria-label="Zoom in time scale" disabled={tickMs <= 1_000} onClick={() => setTickMs((tick) => Math.max(1_000, tick / 2))}>+</button>
      <button className="tg-button" onClick={() => setTickMs(timeTick(bounds.duration))}>Fit duration</button>
    </div>
    {!rows.length ? <div className="tg-waterfall__empty">{snapshot.nodes.length ? "No tasks match this filter." : "Execution will appear when tasks are added to this graph."}</div> : <div className="tg-flow-scroll tg-waterfall__scroll" role="region" tabIndex={0} aria-label="Waterfall canvas">
      <div className="tg-flow-canvas tg-waterfall__canvas" style={{ width, height }}>
        <div className="tg-waterfall__axis" style={{ width }} aria-hidden="true">
          <span className="tg-waterfall__axis-label">Tasks</span>
          {Array.from({ length: Math.min(tickCount + 1, 200) }, (_, index) => {
            const tick = index * Math.max(1, Math.ceil(tickCount / 199));
            return tick <= tickCount ? <span key={tick} style={{ left: xAt(bounds.start + tick * tickMs) }}>{elapsedLabel(tick * tickMs)}</span> : null;
          })}
        </div>
        <svg className="tg-flow-edges tg-waterfall__edges" width={width} height={height} aria-hidden="true">
          <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
          {projection.edges.map((edge) => {
            const source = segments.get(edge.source)?.at(-1);
            const target = segments.get(edge.target)?.at(0);
            if (!source || !target || source.finishUnknown) return null;
            const x1 = xAt(source.end), x2 = xAt(target.start);
            const y1 = AXIS_HEIGHT + rowIndex.get(edge.source)! * ROW_HEIGHT + ROW_HEIGHT / 2;
            const y2 = AXIS_HEIGHT + rowIndex.get(edge.target)! * ROW_HEIGHT + ROW_HEIGHT / 2;
            const isRelated = edge.source === selectedNodeId || edge.target === selectedNodeId;
            const dimmed = focus.size > 0 && !focus.has(edge.source) && !focus.has(edge.target);
            return <path key={edge.id} className={`tg-flow-edge tg-flow-edge--${edge.type} tg-flow-edge--${edge.state}${isRelated ? " is-related" : ""}${dimmed ? " is-dimmed" : ""}`}
              d={`M ${x1} ${y1} C ${x1 + 24} ${y1}, ${x2 - 24} ${y2}, ${x2} ${y2}`} markerEnd={`url(#${markerId})`} />;
          })}
        </svg>
        {rows.map((node, index) => {
          const attempts = segments.get(node.id)!;
          const selected = selectedNodeId === node.id;
          const dimmed = focus.size > 0 && !focus.has(node.id);
          return <div key={node.id} data-node-id={node.id} data-signal={graphSignal(node)}
            className={`tg-waterfall__row${selected ? " is-selected" : ""}${related.has(node.id) ? " is-related" : ""}${dimmed ? " is-dimmed" : ""}`}
            style={{ top: AXIS_HEIGHT + index * ROW_HEIGHT, width }}>
            <button type="button" className="tg-waterfall__label tg-graph-card" aria-pressed={selected}
              aria-label={`${node.title}; ${modelLabel(node)}; logical ${node.logicalState}; ${whyNotRunning(node)}`} onClick={() => onSelect(node.id)}>
              <span className="tg-waterfall__title"><strong title={node.title}>{node.title}</strong></span>
              <span className="tg-waterfall__metadata">
                <span className="tg-waterfall__status"><NodeState node={node} compact />{node.currentAttempt?.state ?? node.readiness}</span>
                <ModelLabel node={node} />
              </span>
            </button>
            <div className="tg-waterfall__lane" style={{ left: LABEL_WIDTH, width: plotWidth + 28, backgroundSize: `${TICK_WIDTH}px 100%` }} />
            {attempts.map((segment) => {
              const duration = elapsedLabel(segment.end - segment.start);
              const label = `Attempt ${segment.attempt.number} · ${segment.attempt.state} · ${segment.finishUnknown ? "finish time unavailable" : duration}`;
              const segmentWidth = Math.max(6, (segment.end - segment.start) / tickMs * TICK_WIDTH);
              return <button key={segment.attempt.id} type="button" data-attempt-id={segment.attempt.id} data-duration-ms={segment.end - segment.start}
                data-signal={segment.running ? "running" : segment.attempt.state === "succeeded" ? "complete" : segment.attempt.state === "failed" ? "failed" : "stopped"}
                className={`tg-waterfall__bar tg-graph-card${segment.running && running ? " is-live" : ""}${segment.finishUnknown ? " is-unknown" : ""}`}
                style={{ left: xAt(segment.start), width: segmentWidth }}
                aria-label={`${node.title}; ${label}`} aria-pressed={selected} title={`${label}\nStarted ${new Date(segment.start).toLocaleString()}`} onClick={() => onSelect(node.id)}>
                <span aria-hidden="true">{segmentWidth >= 64 ? `#${segment.attempt.number} · ${segment.finishUnknown ? "—" : duration}` : ""}</span>
              </button>;
            })}
            {!attempts.length ? <button type="button" className="tg-waterfall__pending tg-graph-card" style={{ left: LABEL_WIDTH + 16 }}
              onClick={() => onSelect(node.id)} aria-pressed={selected} title={whyNotRunning(node)}>
              {node.currentAttempt?.state === "queued" || (!node.currentAttempt && node.logicalState === "pending") ? "Not started" : "Timing unavailable"} · {whyNotRunning(node)}
            </button> : null}
          </div>;
        })}
      </div>
    </div>}
    <div className="tg-flow-hint">Scroll to explore time · Select a task or attempt to inspect · Lane order follows dependencies</div>
  </div>;
}
