import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { WorkItemRunSnapshot } from "../../shared/work-item-contracts.ts";
import type { WorkItemHistoryState } from "../use-work-item-history.ts";
import { childRunContext, type RunTaskContext } from "../work-item-run-context.ts";
import { SessionTranscript } from "./SessionTranscript.tsx";
import "./run-history-disclosure.css";

/** Mounting a preview is the only trigger for retrieving a non-recent run. */
export function RunReplay({ run, history }: {
  run: WorkItemRunSnapshot;
  history: WorkItemHistoryState;
}) {
  const { loadRun, releaseRun } = history;
  useEffect(() => {
    loadRun(run.runKey);
    return () => releaseRun(run.runKey);
  }, [loadRun, releaseRun, run.runKey]);
  const status = history.runStatus[run.runKey];
  if (status === "unavailable") return <p role="status">This run's transcript is unavailable.</p>;
  if (status !== "ready") return <p role="status">Loading run transcript…</p>;
  const stream = history.streams[run.runKey];
  return <SessionTranscript messages={stream?.messages ?? []} streamingText={stream?.streamingText ?? ""} autoFollow={false} />;
}

export function ChildRunDisclosure({ run, history, context = {}, navigation }: {
  run: WorkItemRunSnapshot;
  history: WorkItemHistoryState;
  context?: RunTaskContext;
  navigation?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { content: title, objective, details, inspectNodeId, label } = childRunContext(run, context);
  const description = [details, objective?.slice(0, 480)].filter(Boolean).join(" — ");
  return <div className="run-history-child">
    <div className="run-history-heading">
      <button className="run-history-toggle" type="button" aria-expanded={open}
        aria-label={`${open ? "Hide child transcript" : "Show child transcript"}: ${title}`}
        aria-description={description || undefined}
        title={[title, description].filter(Boolean).join(" — ")} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span className="child-run-title">{title}</span>
        {details && <span className="child-run-meta">{details}</span>}
        {objective && <span className="child-run-objective">{objective.slice(0, 160)}{objective.length > 160 ? "…" : ""}</span>}
      </button>
      {navigation ?? (inspectNodeId && context.onInspectNode ? <button type="button"
        aria-label={`Inspect ${label}`} onClick={() => context.onInspectNode?.(inspectNodeId)}>Inspect</button> : null)}
    </div>
    {open && <RunReplay run={run} history={history} />}
  </div>;
}

const PAGE_SIZE = 10;

/** A bounded, skim-first index. Only one older iteration is mounted at a time. */
export function RunHistoryDisclosure({ history, navigation, context = {} }: {
  history: WorkItemHistoryState; navigation?: ReactNode; context?: RunTaskContext;
}) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const rows = history.olderRuns.slice(0, visibleCount);
  const selected = history.olderRuns.find((run) => run.runKey === selectedKey);
  const children = selected ? history.orderedRuns.filter((run) => run.runKind === "child"
    && run.parentRunKey === selected.runKey) : [];
  const more = visibleCount < history.olderRuns.length || history.hasMore;
  function advance() {
    if (history.loading) return;
    if (visibleCount < history.olderRuns.length) setVisibleCount((count) => count + PAGE_SIZE);
    else {
      setVisibleCount((count) => count + PAGE_SIZE);
      history.loadMore();
    }
  }
  function moveSelection(delta: number) {
    const index = history.olderRuns.findIndex((run) => run.runKey === selectedKey);
    const next = history.olderRuns[index + delta];
    if (next) {
      setSelectedKey(next.runKey);
      setVisibleCount((count) => Math.max(count, index + delta + 1));
    }
  }
  return <section className="run-history-browser" aria-label="Older iteration history">
    <div className="run-history-heading">
      <button className="run-history-toggle" type="button" aria-expanded={open}
        title="Select an earlier iteration to load its transcript" onClick={() => {
          setOpen(!open);
          if (!open && !rows.length) history.loadMore();
        }}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span>{open ? "Hide" : "Browse"} older iterations · {history.olderRuns.length}{history.hasMore ? "+" : ""}</span>
      </button>
      {navigation}
    </div>
    {open && <>
      <div className="run-history-index" tabIndex={0} aria-label="Older iterations" onScroll={(event) => {
        const el = event.currentTarget;
        if (el.scrollTop > 0 && el.scrollHeight - el.scrollTop - el.clientHeight < 48) advance();
      }}>
        {rows.map((run) => <button className="run-history-row" type="button" key={run.runKey}
          aria-label={`Iteration ${run.runNumber ?? "?"} · ${run.outcome} · ${new Date(run.startedAt).toLocaleString()}`}
          aria-expanded={selectedKey === run.runKey}
          onClick={() => setSelectedKey(selectedKey === run.runKey ? null : run.runKey)}>
          <strong>Iteration {run.runNumber ?? "?"}</strong>
          <span>{run.outcome === "none" ? "Active now" : run.outcome}</span>
          <time dateTime={new Date(run.startedAt).toISOString()} title={new Date(run.startedAt).toLocaleString()}>
            {new Date(run.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </time>
          {run.finalReport && <small>{run.finalReport.slice(0, 180)}</small>}
        </button>)}
        {more && <button type="button" disabled={history.loading} onClick={advance}>Load older iterations</button>}
        {history.loading && <p role="status">Loading iteration history…</p>}
        {!rows.length && !history.loading && !history.hasMore && <p>No older iterations.</p>}
      </div>
      {selected && <section className="run-history-preview" aria-label={`Iteration ${selected.runNumber} preview`}>
        <header>
          <strong>Iteration {selected.runNumber} · {selected.outcome}</strong>
          <button type="button" aria-label="Newer iteration" title="Newer iteration"
            disabled={selectedKey === history.olderRuns[0]?.runKey}
            onClick={() => moveSelection(-1)}><ArrowUp size={14} aria-hidden /></button>
          <button type="button" aria-label="Older iteration" title="Older iteration"
            disabled={selectedKey === history.olderRuns.at(-1)?.runKey}
            onClick={() => moveSelection(1)}><ArrowDown size={14} aria-hidden /></button>
          <button type="button" aria-label="Close preview" title="Close preview"
            onClick={() => setSelectedKey(null)}><X size={14} aria-hidden /></button>
        </header>
        <RunReplay key={selected.runKey} run={selected} history={history} />
        {children.map((child) => <ChildRunDisclosure key={child.runKey} run={child} history={history} context={context} />)}
      </section>}
    </>}
  </section>;
}
