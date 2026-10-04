import type { LeaderData } from "./types.ts";
import type { SocketSubscribeLike } from "../../use-socket.ts";
import { useReviewDiff } from "../../use-review-diff.ts";
import { ReviewFiles, ReviewIdentity, canDecideFromReview } from "../../components/review/ReviewEvidence.tsx";

/** Legacy branch strategy controls require current, run-identified patch evidence.
 * This is a UI precondition, not canonical contribution approval or a new merge authority. */
export function LegacyConflictReview({ data, socketSend, socketSubscribe, onUpdateData, onDiscard }: {
  data: LeaderData;
  socketSend: ((data: unknown) => void) | undefined;
  socketSubscribe: SocketSubscribeLike;
  onUpdateData: (data: LeaderData) => void;
  onDiscard: () => void;
}) {
  const review = useReviewDiff(data.sessionKey ?? "", socketSend, socketSubscribe);
  const ready = canDecideFromReview(review.diff, review.loading, review.error);
  const conflict = data.mergeConflict;
  if (!conflict) return null;
  return (
          <section className="legacy-conflict-review" aria-label="Merge conflict review"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              margin: "0 6px 6px",
              padding: "10px 12px",
              background: "var(--danger-bg)",
              border: "2px solid var(--danger-color)",
              borderRadius: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--status-error)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 14 }}>!</span> Merge Conflicts
              </div>
              <button
                onClick={() => onUpdateData({ ...data, mergeConflict: null })}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: "0 2px",
                  lineHeight: 1,
                }}
                title="Dismiss"
                aria-label="Dismiss merge conflicts"
              >
                x
              </button>
            </div>
            {conflict.conflicts.length > 0 && (
              <div
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text-muted)",
                  marginBottom: 8,
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg-elevated)",
                  padding: "6px 8px",
                  borderRadius: 4,
                  maxHeight: 80,
                  overflowY: "auto",
                }}
              >
                {conflict.conflicts.map((f, i) => (
                  <div key={i} style={{ padding: "1px 0" }}>
                    {f}
                  </div>
                ))}
              </div>
            )}
            <ReviewIdentity diff={review.diff} sessionKey={data.sessionKey ?? ""} loading={review.loading} error={review.error} />
            {review.error ? <p role="alert">{review.error}</p> : null}
            <button type="button" className="tg-button" disabled={review.loading} onClick={review.refresh}>{review.error ? "Retry loading changes" : review.loading ? "Loading changes…" : "Refresh changes"}</button>
            {review.diff ? <ReviewFiles diff={review.diff} /> : null}
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                marginBottom: 6,
                lineHeight: 1.4,
              }}
            >
              Choose a resolution strategy:
            </div>
            <div
              style={{ display: data.workItemId ? "none" : "flex", gap: 6, flexWrap: "wrap" }}
              className="legacy-conflict-actions"
              data-no-drag
            >
              <button
                disabled={!ready}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (ready && socketSend && data.sessionKey && !data.workItemId) {
                    socketSend({ type: "force_merge", sessionKey: data.sessionKey });
                    onUpdateData({
                      ...data,
                      worktreeStatus: "merging",
                      mergeConflict: null,
                      approvalPending: false,
                    });
                  }
                }}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 6,
                  color: "var(--text-on-accent)",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                }}
                title="Keep canvas branch changes where conflicts occur"
              >
                Keep Ours
              </button>
              <button
                disabled={!ready}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (ready && socketSend && data.sessionKey && !data.workItemId) {
                    socketSend({ type: "theirs_merge", sessionKey: data.sessionKey });
                    onUpdateData({
                      ...data,
                      worktreeStatus: "merging",
                      mergeConflict: null,
                      approvalPending: false,
                    });
                  }
                }}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 6,
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                }}
                title="Keep main branch changes where conflicts occur"
              >
                Keep Main
              </button>
              <button
                disabled={!ready}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (ready && socketSend && data.sessionKey && !data.workItemId) {
                    socketSend({ type: "retry_merge", sessionKey: data.sessionKey });
                    onUpdateData({
                      ...data,
                      worktreeStatus: "merging",
                      mergeConflict: null,
                      approvalPending: false,
                    });
                  }
                }}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.8125rem",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 6,
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                }}
                title="Re-attempt a clean merge (use after manually resolving conflicts in the worktree)"
              >
                Retry
              </button>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (socketSend && data.sessionKey) onDiscard();
                }}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.8125rem",
                  background: "var(--danger-bg)",
                  border: "1px solid var(--danger-color)",
                  borderRadius: 6,
                  color: "var(--status-error)",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Discard
              </button>
            </div>
          </section>
  );
}
