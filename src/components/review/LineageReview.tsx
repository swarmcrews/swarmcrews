import type { WorktreeLineageSnapshot } from "../../../shared/worktree-integration.ts";
import type { ReviewDiff } from "../../../shared/review-diff.ts";
import type { SocketSubscribeLike } from "../../use-socket.ts";
import { useIntegrationReviewDiff } from "../../use-integration-review-diff.ts";
import { ReviewFiles, ReviewIdentity } from "./ReviewEvidence.tsx";

export function matchesLineage(diff: ReviewDiff | null, lineage: WorktreeLineageSnapshot | null): boolean {
  const snapshot = diff?.snapshot;
  return !!lineage && !!snapshot && snapshot.contributionBinding === "lineage" && snapshot.consistency === "immutable"
    && snapshot.lineageId === lineage.id && snapshot.lineageRevision === lineage.revision
    && snapshot.baseSha === lineage.baseSha && snapshot.headSha === lineage.integrationHeadSha;
}
export function useLineageReview(lineage: WorktreeLineageSnapshot | null, send: (data: unknown) => void, subscribe?: SocketSubscribeLike) {
  const review = useIntegrationReviewDiff(lineage?.id ?? "", undefined,
    JSON.stringify([lineage?.revision, lineage?.baseSha, lineage?.integrationHeadSha]), send, subscribe);
  return { ...review, ready: matchesLineage(review.diff, lineage) && !review.loading && !review.error
    && !!review.diff && review.diff.files.every(file => file.patch && file.patch.state !== "unavailable") };
}
export function LineageReview({ review }: { review: ReturnType<typeof useLineageReview> }) {
  return <section aria-label="Combined lineage patch evidence" className="review-files">
    <h4>Combined lineage changes</h4>
    <ReviewIdentity diff={review.diff} sessionKey="" loading={review.loading} error={review.error} />
    {!review.ready && <p className="review-feedback" role="status">Final approval requires evidence matching the current combined head and lineage revision.</p>}
    {review.error && <p className="review-feedback" role="alert">{review.error}</p>}
    <button type="button" className="lin-btn lin-btn--sm" disabled={review.loading} onClick={review.refresh}>
      {review.loading ? "Loading combined patch…" : "Refresh combined patch"}
    </button>
    {review.diff && <ReviewFiles diff={review.diff} />}
  </section>;
}
