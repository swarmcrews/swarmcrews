import { z } from "zod";

export const PROJECT_ACTIVITY_BATCH_SIZE = 100;
export const projectActivityRequestSchema = z.object({
  projectIds: z.array(z.string().min(1).max(1024)).max(PROJECT_ACTIVITY_BATCH_SIZE),
}).strict();

export const projectActivitySummarySchema = z.object({
  projectId: z.string().min(1),
  activeLeaders: z.number().int().nonnegative(),
  activeCrew: z.number().int().nonnegative(),
});

export const projectActivityResponseSchema = z.array(projectActivitySummarySchema);
export type ProjectActivitySummary = z.infer<typeof projectActivitySummarySchema>;
