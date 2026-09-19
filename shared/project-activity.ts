import { z } from "zod";

export const PROJECT_ACTIVITY_BATCH_SIZE = 100;
export const projectActivityRequestSchema = z.object({
  projectIds: z.array(z.string().min(1).max(1024)).max(PROJECT_ACTIVITY_BATCH_SIZE),
}).strict();

export interface ProjectActivitySummary {
  projectId: string;
  activeSessions: number;
}
