/**
 * get_worktree_diff — inspect isolated changes against the base branch, or
 * current shared workspace changes for live sessions. This grants no approval.
 */

import { getDetailedDiff } from "../worktree.ts";
import { getWorkspaceDiff } from "../workspace-diff.ts";
import { readCanonicalReviewDiff } from "../canonical-review-diff.ts";
import { getSessionOrError, sendControlError, sendControlResponse, errToMessage } from "./helpers.ts";
import type { CommandHandler } from "./types.ts";

export const getWorktreeDiff: CommandHandler = (ctx, cmd, ws) => {
  const host = getSessionOrError(ctx.registry, cmd.sessionKey, ws);
  if (!host) return;
  if (!host.worktree && host.worktreeIsolation) {
    sendControlError(ws, "get_worktree_diff", cmd.sessionKey!, cmd.requestId, "No worktree for this session");
    return;
  }
  const read = async () => {
    const service = ctx.worktreeIntegrations;
    const lineage = host.workItemId && service ? await service.getStatus({ runKey: host.runKey }) : null;
    const entry = lineage?.contributions.find(value => value.runKeys.includes(host.runKey));
    if (entry && lineage && service && (entry.headSha || entry.state === "ready")) {
      if (entry.workItemId !== host.workItemId) throw new Error("Contribution does not belong to this work item.");
      const diff = await readCanonicalReviewDiff(lineage.repositoryPath, entry, host.runKey);
      const latest = (await service.getStatus({ runKey: host.runKey }))?.contributions.find(value => value.id === entry.id);
      if (!latest || latest.revision !== entry.revision || latest.headSha !== entry.headSha || latest.baseSha !== entry.baseSha) {
        throw new Error("Contribution changed while capturing review evidence. Refresh for its latest revision.");
      }
      return diff;
    }
    return host.worktree ? getDetailedDiff(host.worktree) : getWorkspaceDiff(host.cwd);
  };
  read()
    .then((diff) => {
      // Run identity is derived from the validated host, never supplied by the client.
      if (diff.snapshot) diff.snapshot = { ...diff.snapshot, runKey: host.runKey };
      sendControlResponse(ws, "get_worktree_diff", cmd.sessionKey!, cmd.requestId, { diff });
    })
    .catch((err: unknown) => {
      sendControlError(ws, "get_worktree_diff", cmd.sessionKey!, cmd.requestId, errToMessage(err));
    });
};
