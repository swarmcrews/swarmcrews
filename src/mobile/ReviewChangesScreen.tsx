import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ChangeMode } from "../../shared/work-item-lifecycle.ts";

import { randomUuid } from "../random-id.ts";
import { useWorktreeIntegration } from "../use-worktree-integration.ts";
import { WorktreeIntegrationControls } from "../WorktreeIntegrationControls.tsx";
import { useReviewDiff } from "../use-review-diff.ts";
import { ReviewFiles, ReviewIdentity, canDecideFromReview } from "../components/review/ReviewEvidence.tsx";
import { LiveChangesPanel } from "../LiveChangesPanel.tsx";
import type { ServerMessage, SocketSubscribe } from "../use-socket.ts";
import {
  formatDiffStat,
} from "./mobile-approvals.ts";

interface ReviewChangesScreenProps {
  embedded?: boolean;
  approvalPending?: boolean;
  sessionKey: string;
  workItemId?: string | null | undefined;
  changeMode?: ChangeMode | undefined;
  send: (data: unknown) => void;
  subscribe: SocketSubscribe;
  onClose: () => void;
  onRequestChanges?: ((prompt: string) => boolean) | undefined;
  summary?: string | undefined;
  title?: string | undefined;
}

interface MergeConflict {
  conflicts: string[];
  summary: string;
  targetBranch?: string | undefined;
}

export function ReviewChangesScreen({
  changeMode,
  workItemId,
  ...props
}: ReviewChangesScreenProps) {
  const Container = props.embedded ? "section" : "main";
  if (changeMode === "live" || (workItemId && changeMode !== "worktree")) {
    return (
      <Container className="mob-review" aria-label="Workspace changes">
        {props.embedded ? null : <header className="mob-chat-header">
          <button className="mob-icon-button" type="button" onClick={props.onClose} aria-label="Close">
            ×
          </button>
          <div className="mob-chat-title">
            <span>Workspace changes</span>
            <h1>{props.title ?? props.sessionKey}</h1>
          </div>
        </header>}
        <section className="mob-review-body">
          <LiveChangesPanel key={props.sessionKey} sessionKey={props.sessionKey} send={props.send} subscribe={props.subscribe} />
        </section>
      </Container>
    );
  }
  return <WorktreeReviewChangesScreen key={props.sessionKey} {...props} workItemId={workItemId} changeMode={changeMode} />;
}

function WorktreeReviewChangesScreen({
  sessionKey,
  workItemId,
  send,
  subscribe,
  onClose,
  onRequestChanges,
  summary,
  title,
  embedded,
  approvalPending = false,
}: ReviewChangesScreenProps) {
  const Container = embedded ? "section" : "main";
  const { diff, loading, error: diffError, refresh } = useReviewDiff(sessionKey, send, subscribe);
  const reviewReady = canDecideFromReview(diff, loading, diffError);
  const [error, setError] = useState<string | null>(null);
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackFocused, setFeedbackFocused] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [conflict, setConflict] = useState<MergeConflict | null>(null);
  const integration = useWorktreeIntegration({ workItemId: workItemId ?? null,
    runKey: sessionKey, send, subscribe });

  useEffect(() => {
    return subscribe("*", (msg: ServerMessage) => {
      if (!workItemId && msg.type === "worktree_merge_failed" && msg.sessionKey === sessionKey) {
        setConflict({
          conflicts: msg.result?.conflicts ?? [],
          summary: msg.result?.summary ?? msg.error ?? "Merge conflicts detected.",
          targetBranch: msg.result?.targetBranch,
        });
        return;
      }

      if (
        (msg.type === "worktree_merged" || msg.type === "session_completed") &&
        msg.sessionKey === sessionKey
      ) {
        onClose();
      }
    });
  }, [onClose, sessionKey, subscribe, workItemId]);

  const canonicalEvidenceVisible = Boolean(workItemId && integration.lineage
    && integration.contribution?.state === "ready" && integration.contribution.reviewState === "pending");
  const emptyChanges = diff !== null && diff.filesChanged === 0 && diff.commits.length === 0;
  // Changes is now browsable without an approval request. Keep legacy merge
  // actions scoped to a real pending decision; canonical integration has its
  // own revision and gate validation in WorktreeIntegrationControls.
  const showActions = !embedded || approvalPending || Boolean(workItemId && diff && !emptyChanges);
  const commitsLabel = useMemo(() => {
    if (!diff) return "";
    return `${diff.commits.length} ${diff.commits.length === 1 ? "commit" : "commits"}`;
  }, [diff]);

  function handleRequestChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = feedback.trim();
    if (!prompt) return;
    if (workItemId) {
      if (onRequestChanges?.(prompt) !== true) {
        setError("Work item details are still loading. Your feedback has been preserved.");
        return;
      }
    } else send({ type: "send_message", sessionKey, prompt });
    setFeedback("");
    setRequestingChanges(false);
    onClose();
  }

  return (
    <Container className="mob-review" aria-label="Review changes">
      {embedded ? null : <header className="mob-chat-header">
        <button className="mob-icon-button" type="button" onClick={onClose} aria-label="Close review">
          ×
        </button>
        <div className="mob-chat-title">
          <span>Review changes</span>
          <h1>{title ?? sessionKey}</h1>
        </div>
      </header>}

      <section className="mob-review-body">
        <div className="mob-review-summary">
          <h2>{emptyChanges ? "No changes to review" : "Session changes"}</h2>
          {summary ? <p>{summary}</p> : null}
          {diff ? (
            <p className="mob-review-stat">
              {formatDiffStat(diff)} · {commitsLabel} · {diff.branch}
            </p>
          ) : null}
        </div>

        {!diff && loading && !diffError ? (
          <div className="mob-review-loading" role="status">Loading diff...</div>
        ) : null}
        {!canonicalEvidenceVisible && <ReviewIdentity diff={diff} sessionKey={sessionKey} loading={loading} error={diffError} />}
        {error ? <div className="mob-review-error" role="alert">{error}</div> : null}
        {diffError ? <div className="mob-review-error" role="alert">{diffError}</div> : null}
        <button className="changes-btn" type="button" onClick={refresh} disabled={loading}>{diffError ? "Retry loading changes" : "Refresh changes"}</button>


        {diff ? (
          <>
            {!canonicalEvidenceVisible && <section className="mob-review-section" aria-label="Changed files">
              <h2>Files</h2>
              <ReviewFiles diff={diff} />
            </section>}

            <section className="mob-review-section" aria-label="Commits">
              <h2>Commits</h2>
              {diff.commits.length === 0 ? (
                <p className="mob-muted">No commits reported.</p>
              ) : (
                <ul className="mob-commit-list">
                  {diff.commits.map((commit) => (
                    <li key={commit}>{commit}</li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}

        {conflict ? (
          <section className="mob-conflict-panel" aria-label="Merge conflict">
            <h2>Merge conflict</h2>
            <p>{conflict.summary}</p>
            {conflict.targetBranch ? <p className="mob-muted">Target: {conflict.targetBranch}</p> : null}
            {conflict.conflicts.length > 0 ? (
              <ul className="mob-conflict-list">
                {conflict.conflicts.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            ) : null}
            {!workItemId ? <div className="mob-conflict-actions">
              <button type="button" disabled={!reviewReady} onClick={() => { if (reviewReady) send({ type: "retry_merge", sessionKey }); }}>
                Retry
              </button>
              <button type="button" disabled={!reviewReady} onClick={() => { if (reviewReady) send({ type: "force_merge", sessionKey }); }}>
                Force
              </button>
              <button type="button" disabled={!reviewReady} onClick={() => { if (reviewReady) send({ type: "theirs_merge", sessionKey }); }}>
                Theirs
              </button>
            </div> : null}
          </section>
        ) : null}
        {workItemId && integration.lineage ? <section className="mob-review-section"
          aria-label="Worktree integration">
          <h2>Integration</h2>
          <WorktreeIntegrationControls lineage={integration.lineage} workItemId={workItemId}
            runKey={sessionKey} send={send} className="integration-controls--mobile" subscribe={subscribe} />
        </section> : null}
      </section>

      {showActions ? <footer className="mob-review-actions">
        {!workItemId && !reviewReady && <p className="review-decision-help">Merge unavailable until an identified review is loaded without a refresh error.</p>}
        {requestingChanges ? (
          <form
            className="mob-review-feedback"
            data-focused={feedbackFocused ? "true" : "false"}
            onSubmit={handleRequestChanges}
          >
            <label htmlFor="mob-review-feedback">Request changes</label>
            <textarea
              id="mob-review-feedback"
              value={feedback}
              onChange={(event) => setFeedback(event.currentTarget.value)}
              onFocus={() => setFeedbackFocused(true)}
              onBlur={() => setFeedbackFocused(false)}
              placeholder="Describe what needs to change"
              rows={3}
            />
            <div className="mob-review-feedback-actions">
              <button type="button" onClick={() => setRequestingChanges(false)}>
                Cancel
              </button>
              <button type="submit" disabled={feedback.trim().length === 0}>Send</button>
            </div>
          </form>
        ) : null}

        {confirmDiscard ? (
          <div className="mob-discard-confirm" role="group" aria-label="Confirm discard">
            <span>Discard this worktree?</span>
            <button type="button" onClick={() => setConfirmDiscard(false)}>
              Cancel
            </button>
            <button type="button" onClick={() => {
              if (integration.contribution) send({ type: "discard_worktree_contribution",
                requestId: randomUuid(), contributionId: integration.contribution.id,
                expectedIntegrationRevision: integration.contribution.revision,
                reason: "Discarded from mobile review" });
              else if (!workItemId) send({ type: "discard_worktree", sessionKey });
            }}>
              Discard
            </button>
          </div>
        ) : null}

        <div className="mob-review-action-row">
          {!workItemId ? <button
            className="mob-primary-action"
            type="button"
            disabled={Boolean(conflict) || !reviewReady}
            onClick={() => send({ type: "approve_changes", sessionKey })}
          >
            Approve &amp; Merge
          </button> : null}
          <button type="button" onClick={() => setRequestingChanges(true)}>
            Request changes
          </button>
          {!workItemId ? <button type="button" onClick={() => setConfirmDiscard(true)}>
            Discard
          </button> : null}
        </div>
      </footer> : null}
    </Container>
  );
}
