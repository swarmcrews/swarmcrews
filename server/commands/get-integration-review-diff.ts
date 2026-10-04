/** Durable, read-only Git evidence. This command never grants integration authority. */
import { unicastToLineage } from "../bus.ts";
import { readCanonicalReviewDiff, readLineageReviewDiff } from "../canonical-review-diff.ts";
import { WorktreeIntegrationServiceError } from "../worktree-integration-service.ts";
import type { CommandHandler } from "./types.ts";

export const getIntegrationReviewDiff: CommandHandler = async (ctx, cmd, ws) => {
  const lineageId = cmd.lineageId!;
  const send = (data: Record<string, unknown>) => unicastToLineage(ws, lineageId, {
    type: "integration_review_diff_response", requestId: cmd.requestId ?? null,
    lineageId, contributionId: cmd.contributionId ?? null, ...data,
  });
  try {
    const service = ctx.worktreeIntegrations;
    if (!service) throw new WorktreeIntegrationServiceError("internal", "Integration service unavailable");
    const lineage = await service.getStatus({ lineageId });
    if (!lineage || lineage.id !== lineageId) throw new WorktreeIntegrationServiceError("not_found", "Lineage not found");
    const entry = cmd.contributionId ? lineage.contributions.find(value => value.id === cmd.contributionId) : undefined;
    if (cmd.contributionId && (!entry || entry.lineageId !== lineageId)) {
      throw new WorktreeIntegrationServiceError("not_found", "Contribution not found in this lineage");
    }
    // Repository, SHAs, revision and run come exclusively from durable server records.
    const runKey = entry?.runKeys.at(-1) ?? entry?.originatingRunKey;
    if (entry && (!entry.headSha || !runKey || !entry.runKeys.includes(runKey))) {
      throw new WorktreeIntegrationServiceError("invalid_state", "Contribution has no collected review head or run binding");
    }
    if (!entry && !lineage.integrationHeadSha) {
      throw new WorktreeIntegrationServiceError("invalid_state", "Lineage has no combined review head");
    }
    const diff = entry ? await readCanonicalReviewDiff(lineage.repositoryPath, entry, runKey!) : await readLineageReviewDiff(lineage);
    const latest = await service.getStatus({ lineageId });
    const current = latest?.contributions.find(value => value.id === entry?.id);
    if (!latest || latest.id !== lineageId || latest.repositoryPath !== lineage.repositoryPath
      || (entry ? !current || current.lineageId !== entry.lineageId || current.revision !== entry.revision
        || current.headSha !== entry.headSha || current.baseSha !== entry.baseSha || !current.runKeys.includes(runKey!)
        : latest.revision !== lineage.revision || latest.baseSha !== lineage.baseSha || latest.integrationHeadSha !== lineage.integrationHeadSha)) {
      throw new WorktreeIntegrationServiceError("conflict", "Integration changed while capturing evidence. Refresh the latest revision.");
    }
    send({ success: true, diff });
  } catch (error) {
    send({ success: false, code: error instanceof WorktreeIntegrationServiceError ? error.code : "internal",
      error: error instanceof Error ? error.message : "Review evidence unavailable" });
  }
};
