import { z } from "zod";

// This read-only projection is deliberately separate from the legacy task/crew
// roster. It grants no approval authority: decisions still target live callbacks.
// Covers the graph contract's maximum active-attempt budget while leaving
// headroom below the connection's 128 explicit-session subscription bound.
export const MAX_APPROVAL_CHILDREN = 100;
export const approvalChildSchema = z.object({
  sessionKey: z.string().min(1),
  taskId: z.string().min(1),
  attemptId: z.string().min(1),
  attemptNumber: z.number().int().positive(),
  title: z.string().max(256),
});
export const approvalChildrenSchema = z.array(approvalChildSchema).max(MAX_APPROVAL_CHILDREN);
export type ApprovalChild = z.infer<typeof approvalChildSchema>;
