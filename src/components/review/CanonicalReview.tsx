import type { WorktreeContributionSnapshot } from "../../../shared/worktree-integration.ts";
import type { ReviewDiff } from "../../../shared/review-diff.ts";
import type { SocketSubscribeLike } from "../../use-socket.ts";
import { useIntegrationReviewDiff } from "../../use-integration-review-diff.ts";
import { ReviewFiles, ReviewIdentity } from "./ReviewEvidence.tsx";

export function matchesContribution(diff: ReviewDiff | null, entry: WorktreeContributionSnapshot | null): boolean {
  const snapshot = diff?.snapshot;
  return !!entry && !!snapshot && snapshot.contributionBinding === "bound" && snapshot.consistency === "immutable"
    && snapshot.contributionId === entry.id && snapshot.contributionRevision === entry.revision
    && snapshot.lineageId === entry.lineageId && snapshot.baseSha === entry.baseSha && snapshot.headSha === entry.headSha
    && !!snapshot.runKey && entry.runKeys.includes(snapshot.runKey);
}
export function useCanonicalReview(entry: WorktreeContributionSnapshot | null, send: (data: unknown) => void, subscribe?: SocketSubscribeLike) {
  const runKey = entry?.runKeys.at(-1) ?? "";
  const review = useIntegrationReviewDiff(entry?.lineageId ?? "", entry?.id,
    JSON.stringify([entry?.revision, entry?.baseSha, entry?.headSha]), send, subscribe);
  return { ...review, runKey, ready: matchesContribution(review.diff, entry) && !review.loading && !review.error
    && !!review.diff && review.diff.files.every(file => file.patch && file.patch.state !== "unavailable") };
}
export function CanonicalReview({ review }: { review: ReturnType<typeof useCanonicalReview> }) {
  return <section aria-label="Contribution patch evidence" className="review-files">
    <ReviewIdentity diff={review.diff} sessionKey={review.runKey} loading={review.loading} error={review.error} />
    {!review.ready && <p className="review-feedback" role="status">Approval requires loaded evidence matching this contribution revision.</p>}
    {review.error && <p className="review-feedback" role="alert">{review.error}</p>}
    <button type="button" className="lin-btn lin-btn--sm" disabled={review.loading} onClick={review.refresh}>
      {review.loading ? "Loading contribution patch…" : "Refresh contribution patch"}
    </button>
    {review.diff && <ReviewFiles diff={review.diff} />}
  </section>;
}
