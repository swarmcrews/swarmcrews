import { ChildRunDisclosure, RunHistoryDisclosure } from "./components/RunHistoryDisclosure.tsx";
import type { WorkItemRunSnapshot } from "../shared/work-item-contracts.ts";
import type { DisplayMessage } from "./sdk-messages.ts";
import { preserveOptimisticUserMessages, type SessionStreamState } from "./session-stream.ts";
import { SessionTranscript, type TranscriptBoundary, type TranscriptEntry } from "./components/SessionTranscript.tsx";
import type { WorkItemHistoryState } from "./use-work-item-history.ts";

import { childRunContext, type RunTaskContext } from "./work-item-run-context.ts";

function runBoundary(run: WorkItemRunSnapshot, context: RunTaskContext): TranscriptBoundary {
  const child = childRunContext(run, context);
  const onInspectNode = context.onInspectNode;
  const label = run.runKind === "primary" ? `Iteration ${run.runNumber ?? "?"}` : child.label;
  const state = run.outcome === "none" ? "Active now" : run.outcome;
  return {
    id: `work-history-boundary-${run.runKey}`,
    kind: "run-boundary",
    label,
    content: `${label} · ${state}`,
    ...(run.runKind === "child" && child.inspectNodeId && onInspectNode
      ? { onInspect: () => onInspectNode(child.inspectNodeId!) } : {}),
  };
}

export function buildUnifiedWorkItemMessages(input: {
  runs: readonly WorkItemRunSnapshot[];
  streams: Readonly<Record<string, SessionStreamState>>;
  history?: WorkItemHistoryState;
  currentRunKey: string;
  currentMessages: readonly DisplayMessage[];
} & RunTaskContext): TranscriptEntry[] {
  const { streams, currentRunKey, currentMessages, history } = input;
  const runs = history?.recentRuns ?? input.runs;
  // A new leader's first run can reach history before its launch receipt
  // supplies the live session key. Its local prompt belongs to that run.
  const primaryRuns = runs.filter((run) => run.runKind === "primary");
  const initialRun = !currentRunKey && primaryRuns.length === 1
    && primaryRuns[0]?.runNumber === 1
    && currentMessages.every((message) => message.role === "user" && message.optimistic)
    ? primaryRuns[0] : undefined;
  const unified: TranscriptEntry[] = [];
  if (history && (history.olderRuns.length > 0 || history.hasMore)) {
    unified.push({ kind: "run-boundary", id: `older-${input.runs[0]?.workItemId ?? currentRunKey}`,
      label: "Earlier iterations", content: "Earlier iterations",
      disclosure: (navigation) => <RunHistoryDisclosure history={history} navigation={navigation} context={input} /> });
  }
  for (const run of runs) {
    const boundary = runBoundary(run, input);
    if (run.runKind === "child") {
      if (history) boundary.disclosure = (navigation) => <ChildRunDisclosure run={run} history={history}
        context={input} navigation={navigation} />;
      unified.push(boundary);
      continue;
    }
    unified.push(boundary);
    const replay = streams[run.runKey]?.messages ?? [];
    const messages = run === initialRun
      ? preserveOptimisticUserMessages(currentMessages, replay)
      : run.runKey === currentRunKey && currentMessages.length > 0
      ? currentMessages
      : replay;
    unified.push(...messages);
  }
  // Session updates and ledger pages arrive independently. Preserve the
  // current conversation while its run is still missing from cached history.
  if (!initialRun && !runs.some((run) => run.runKey === currentRunKey)) {
    unified.push(...currentMessages);
  }
  return unified;
}

export function WorkItemTranscript(props: {
  runs: readonly WorkItemRunSnapshot[];
  streams: Readonly<Record<string, SessionStreamState>>;
  history?: WorkItemHistoryState;
  currentRunKey: string;
  currentMessages: readonly DisplayMessage[];
  currentStreamingText: string;
  loading: boolean;
  thinking?: boolean | undefined;
} & RunTaskContext) {
  const messages = buildUnifiedWorkItemMessages(props);
  return (
    <div className="act-work-history-transcript" aria-busy={props.loading}>
      {props.loading && (
        <div className="act-work-history-loading" role="status">
          Loading connected run history…
        </div>
      )}
      <SessionTranscript messages={messages} streamingText={props.currentStreamingText}
        thinking={props.thinking} />
    </div>
  );
}

export function ActivityTranscript(props: {
  unified: boolean;
  history: WorkItemHistoryState;
  currentRunKey: string;
  currentMessages: readonly DisplayMessage[];
  currentStreamingText: string;
  thinking?: boolean | undefined;
} & RunTaskContext) {
  if (!props.unified) {
    return <SessionTranscript messages={[...props.currentMessages]}
      streamingText={props.currentStreamingText} thinking={props.thinking} />;
  }
  return <WorkItemTranscript history={props.history} runs={props.history.orderedRuns} streams={props.history.streams}
    currentRunKey={props.currentRunKey} currentMessages={props.currentMessages}
    currentStreamingText={props.currentStreamingText} loading={props.history.loading}
    graphNodes={props.graphNodes} taskPlan={props.taskPlan} onInspectNode={props.onInspectNode}
    thinking={props.thinking} />;
}
