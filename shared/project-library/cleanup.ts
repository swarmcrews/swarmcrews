import { z } from "zod";
const id = z.string().uuid();
const revision = z.number().int().nonnegative();
export const cleanupSelectionSchema = z.object({ projects: z.array(z.object({ id, expectedRevision: revision }).strict()).min(1).max(100)
  .refine(items => new Set(items.map(p => p.id)).size === items.length, "Duplicate project IDs") }).strict();
export const missingProjectsSchema = z.array(z.object({ id, revision, eligible: z.boolean() })).max(100);
export const cleanupResultSchema = z.object({ archived: z.array(id).max(100), skipped: z.array(z.object({ id, reason: z.string() })).max(100) });
export type MissingProject = z.infer<typeof missingProjectsSchema>[number];
export type CleanupSelection = z.infer<typeof cleanupSelectionSchema>["projects"];
export type CleanupResult = z.infer<typeof cleanupResultSchema>;
