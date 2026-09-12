import { containDialogFocus, dismissDialogMenu } from "./dialog-focus.ts";
import { CrewIcon } from "../components/CrewIcon.tsx";
import { useEffect, useId, useRef, type ReactNode } from "react";
import type { TaskGraphPlanSnapshotView } from "../../shared/task-graph-planning-contracts.ts";
import "./task-graph.css";

interface ProposalActions {
  controlsEnabled: boolean;
  stale: boolean;
  onStart: () => void;
  onAdjust?: (() => void) | undefined;
  onReject: () => void;
  onOpen: () => void;
}

export function GraphPlanProposalCard({ snapshot, actions }: {
  snapshot: TaskGraphPlanSnapshotView;
  actions: ProposalActions;
}) {
  const failed = snapshot.state === "failed";
  const parallel = snapshot.steps.filter((step) => step.dependsOn.length === 0).length;
  const canStart = snapshot.state === "ready" && snapshot.canStart
    && actions.controlsEnabled && !actions.stale;
  return (
    <section className="tg-summary tg-plan-proposal" aria-label={`Execution plan ${snapshot.objective}`}>
      <header className="tg-summary__head">
        <div className="tg-summary__identity">
          <span className="tg-summary__leader-mark" aria-hidden="true"><CrewIcon aria-hidden="true" /></span>
          <div><strong>{titleFor(snapshot)}</strong><span>Revision {snapshot.proposalRevision}</span></div>
        </div>
        <span className={`tg-run-status tg-run-status--${snapshot.state}`}>{snapshot.state.replace("_", " ")}</span>
      </header>
      {failed ? <FailedPlanReason error={snapshot.error} /> : <>
        <div className="tg-summary__goal"><span className="tg-eyebrow">Outcome</span>
          <p>{snapshot.objective}</p></div>
        <ol className="tg-plan-proposal__steps">
          {snapshot.steps.slice(0, 5).map((step) => <li key={step.key}>{step.title}</li>)}
        </ol>
        <div className="tg-plan-proposal__meta">
          <span>{snapshot.steps.length} steps</span><span>{parallel} without dependencies</span>
          <span>{snapshot.steps.filter((step) => step.requiresApproval).length} approvals</span>
          {snapshot.pattern ? <span>{snapshot.pattern.id} · v{snapshot.pattern.version}</span> : null}
        </div>
        {actions.stale || snapshot.state === "stale" ? <p className="tg-plan-proposal__warning">
          The source or connection changed. Refresh the plan before starting.
        </p> : null}
        {snapshot.questions[0] ? <p className="tg-plan-proposal__warning">{snapshot.questions[0]}</p> : null}
        {snapshot.patternRecommendation?.id === "p00.direct"
          ? <p className="tg-plan-proposal__warning">Router recommends direct execution for this bounded unit.</p>
          : null}
        <ReviewRequirements requirements={snapshot.reviewRequirements} canStart={canStart} />
        {snapshot.error && snapshot.state !== "stale"
          ? <p className="tg-plan-proposal__warning">{snapshot.error}</p> : null}
      </>}
      <footer className="tg-summary__foot">
        <button type="button" className="tg-button" onClick={actions.onAdjust}>
          {snapshot.state === "stale" ? "Refresh plan" : "Adjust"}
        </button>
        <button type="button" className="tg-button" onClick={actions.onOpen}>Details</button>
        {snapshot.state === "ready" ? <button type="button" className="tg-button tg-button--primary"
          onClick={actions.onStart} disabled={!canStart}>Start</button> : null}
      </footer>
    </section>
  );
}

function FailedPlanReason({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="tg-plan-proposal__failure" title={error}>{summarizeFailure(error)}</p>;
}

function summarizeFailure(error: string): string {
  const concise = error.replace(/\s+/g, " ").trim();
  return concise.length > 160 ? `${concise.slice(0, 157)}…` : concise;
}

export function GraphPlanProposalDialog({ snapshot, actions, onClose, navigation }: {
  snapshot: TaskGraphPlanSnapshotView;
  actions: ProposalActions;
  onClose: () => void;
  navigation?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const canStart = snapshot.state === "ready" && snapshot.canStart
    && actions.controlsEnabled && !actions.stale;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogRef.current && dismissDialogMenu(event, dialogRef.current)) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); return; }
      if (dialogRef.current) containDialogFocus(event, dialogRef.current);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => { window.removeEventListener("keydown", onKeyDown, true); opener?.focus(); };
  }, []);
  return <div className="tg-backdrop tg-backdrop--proposal" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div ref={dialogRef} className="tg-plan-dialog" role="dialog" aria-modal="true" aria-label={`Execution plan: ${snapshot.objective}`} tabIndex={-1}>
      <header className="tg-inspector__header"><div className="tg-plan-dialog__identity">
        <span className="tg-summary__leader-mark" aria-hidden="true"><CrewIcon aria-hidden="true" /></span>
        <div><h2 id={headingId}>{titleFor(snapshot)}</h2><p>{snapshot.objective}</p></div>
      </div><button type="button" className="tg-close" onClick={onClose} aria-label="Close">×</button></header>
      {navigation}
      <div className="tg-plan-dialog__body">
        {snapshot.patternRecommendation ? <section className="tg-plan-pattern">
          <span className="tg-eyebrow">Orchestration pattern</span>
          <strong>{snapshot.pattern
            ? `${snapshot.pattern.id} · v${snapshot.pattern.version}`
            : `Router recommendation: ${snapshot.patternRecommendation.label}`}</strong>
          <p>{snapshot.patternRecommendation.rationale}</p>
          {snapshot.patternTemplate ? <>
            <small>Topology: {snapshot.patternTemplate.topology}</small>
            {snapshot.patternTemplate.requiredArtifacts.length
              ? <small>Artifact vocabulary: {snapshot.patternTemplate.requiredArtifacts.join(", ")}</small>
              : null}
            <ul>{snapshot.patternTemplate.safetyChecks.map(check=><li key={check}>{check}</li>)}</ul>
          </> : null}
          {snapshot.pattern && snapshot.pattern.id !== snapshot.patternRecommendation.id
            ? <small>Router recommendation: {snapshot.patternRecommendation.id}</small> : null}
        </section> : null}
        {snapshot.iteration ? <section className="tg-plan-pattern">
          <span className="tg-eyebrow">Bounded episode</span>
          <strong>{snapshot.iteration.strategy === "successor_revision"
            ? `Successor episode ${snapshot.iteration.episode}` : "Single episode"}</strong>
          {snapshot.iteration.reason ? <p>{snapshot.iteration.reason}</p> : null}
          {snapshot.iteration.stopCondition
            ? <small>Stop when: {snapshot.iteration.stopCondition}</small> : null}
        </section> : null}
        <section><span className="tg-eyebrow">Acceptance criteria</span><ul>
          {snapshot.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}
        </ul></section>
        {snapshot.questions.length ? <section><span className="tg-eyebrow">Open questions</span><ul>{snapshot.questions.map((question) => <li key={question}>{question}</li>)}</ul></section> : null}
        <section><span className="tg-eyebrow">Execution steps</span><ol>
          {snapshot.steps.map((step) => <li key={step.key}><strong>{step.title}</strong>
            <p>{step.objective}</p><small>{step.dependsOn.length
              ? `After ${step.dependsOn.map((key) => snapshot.steps.find((candidate) => candidate.key === key)?.title ?? key).join(", ")}` : "No dependencies"}
              {step.contextSelectors.length ? ` · Context: ${step.contextSelectors.join(", ")}` : ""}</small>
            {Object.keys(step.outputSchemas).length ? <details className="tg-plan-contracts">
              <summary>Artifact contracts ({Object.keys(step.outputSchemas).length})</summary>
              {Object.entries(step.outputSchemas).map(([name,schema]) => <section key={name}>
                <strong>{name}</strong>
                <small>Exact JSON Schema</small><pre>{JSON.stringify(schema,null,2)}</pre>
                <small>Accepted example</small><pre>{JSON.stringify(step.outputExamples[name],null,2)}</pre>
              </section>)}
            </details> : null}
          </li>)}
        </ol></section>
        {snapshot.assumptions.length ? <section><span className="tg-eyebrow">Assumptions</span><ul>
          {snapshot.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
        </ul></section> : null}
        <ReviewRequirements requirements={snapshot.reviewRequirements} detailed canStart={canStart} />
        {snapshot.topologyWarnings.length ? <section className="tg-plan-proposal__warning">
          <strong>Topology preflight</strong><ul>{snapshot.topologyWarnings.map(warning=><li key={warning}>{warning}</li>)}</ul>
        </section> : null}
        {snapshot.error ? <p className="tg-plan-proposal__warning">{snapshot.error}</p> : null}
      </div>
      <footer className="tg-plan-dialog__actions">
        <button type="button" className="tg-button tg-button--danger" onClick={actions.onReject}
          disabled={!actions.controlsEnabled}>Reject</button>
        <button type="button" className="tg-button" onClick={actions.onAdjust}>Adjust in chat</button>
        {snapshot.state === "ready" ? <button type="button" className="tg-button tg-button--primary"
          onClick={actions.onStart} disabled={!canStart}>Start work</button> : null}
      </footer>
    </div>
  </div>;
}

function ReviewRequirements({ requirements, detailed = false, canStart = false }: {
  requirements: TaskGraphPlanSnapshotView["reviewRequirements"];
  detailed?: boolean;
  canStart?: boolean;
}) {
  if (requirements.length === 0) return null;
  return <section className="tg-plan-proposal__review" role="note">
    <strong>Review required before integration</strong>
    <p>{canStart ? "This work is eligible to start. " : "This work is not currently eligible to start. "}Integration remains blocked until these reviews pass or are waived.</p>
    {detailed ? <ul>{requirements.map((requirement) =>
      <li key={requirement.gateId}><strong>{requirement.name}</strong>: {requirement.reason}</li>)}</ul>
      : <span>{requirements.map((requirement) => requirement.name).join(" · ")}</span>}
  </section>;
}

function titleFor(snapshot: TaskGraphPlanSnapshotView): string {
  if (snapshot.state === "needs_input") return "Plan needs input";
  if (snapshot.state === "ready") return "Plan ready";
  if (snapshot.state === "stale") return "Plan needs refresh";
  return `Plan ${snapshot.state}`;
}
