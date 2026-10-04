import { z } from "zod/v4";
import { wsEnvelopeSchema, lineageTopic } from "./ws-envelope.ts";
import { isReviewDiff, type ReviewDiff } from "./review-diff.ts";
import { worktreeIntegrationErrorCodeSchema } from "./worktree-integration.ts";

const identity = wsEnvelopeSchema.extend({ type: z.literal("integration_review_diff_response"),
  requestId: z.string().min(1), lineageId: z.string().min(1), contributionId: z.string().min(1).nullable() });
export const integrationReviewDiffResponseSchema = z.union([
  identity.extend({ success: z.literal(true), diff: z.custom<ReviewDiff>(isReviewDiff) }),
  identity.extend({ success: z.literal(false), code: worktreeIntegrationErrorCodeSchema, error: z.string() }),
]).superRefine((response, ctx) => {
  if (response.topic !== lineageTopic(response.lineageId)) ctx.addIssue({ code: "custom", message: "Review topic does not match lineage" });
  if (!response.success) return;
  const snapshot = response.diff.snapshot;
  if (!snapshot || snapshot.lineageId !== response.lineageId || (response.contributionId
    ? snapshot.contributionBinding !== "bound" || snapshot.contributionId !== response.contributionId
    : snapshot.contributionBinding !== "lineage")) ctx.addIssue({ code: "custom", message: "Review binding does not match requested identity" });
});
export type IntegrationReviewDiffResponse = z.infer<typeof integrationReviewDiffResponseSchema>;
