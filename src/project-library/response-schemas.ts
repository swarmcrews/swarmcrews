import { z } from "zod";
const id = z.string().min(1);
const count = z.number().int().nonnegative();
export const projectSchema = z.object({ id, workspaceId:id, sourceRoot:id, path:id, name:id, displayName:z.string().nullable(), description:z.string(), tags:z.array(z.string()), collectionIds:z.array(id), archived:z.boolean(), focusOrder:count.nullable(), revision:count, createdAt:id, lastOpened:z.string().nullable() });
export const collectionSchema = z.object({ id, name:id });
export const librarySchema = z.object({ projects:z.array(projectSchema), collections:z.array(collectionSchema), focusRevision:count });
const destination = z.discriminatedUnion("view", [z.object({view:z.literal("activity"),workItemId:id}), z.object({view:z.literal("context")})]);
const eventSchema = z.object({id,revision:count,projectId:id,workItemId:id.nullable(),kind:z.enum(["work_item","context"]),text:z.string(),at:z.number().finite(),unread:z.boolean(),destination});
export const eventsSchema = z.object({events:z.array(eventSchema).max(50),receipt:id,nextCursor:id.nullable()});
export const attentionSchema = z.object({items:z.array(z.object({workItemId:id,title:z.string(),revision:count,currentRunKey:id.nullable(),categories:z.array(z.enum(["decision","review","conflict"]))})).max(50),nextCursor:id.nullable()});
export const summariesSchema = z.array(z.object({projectId:id,freshness:z.enum(["fresh","unknown"]),checkedAt:z.string(),expiresAt:z.string(),state:z.enum(["attention","running","new","up_to_date","unknown"]),activeLeaders:count.nullable(),activeCrew:count.nullable(),activeOther:count.nullable(),activeWorkItems:count.nullable(),running:z.boolean().nullable().optional(),runningLeaders:count.nullable().optional(),attention:z.object({total:count,decision:count,review:count,conflict:count}).nullable(),unread:count.nullable(),recent:eventSchema.nullable(),archiveEligible:z.boolean()})).max(100);
export const unreadSchema = z.object({ total: count, projects: count, asOf: count });
export const clearedSchema = z.object({ ok: z.literal(true), cleared: count });
/** Reject malformed responses as recoverable API failures, never fabricated empty/quiet state. */
export function validateResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("Invalid Library response. Retry after the server is available.");
  return result.data;
}

const leaderPreviewSchema = z.object({ workItemId: id, title: z.string(), at: z.number().finite().refine(at => Number.isFinite(new Date(at).getTime())) });
export const activitySchema = z.array(z.object({ projectId: id, recent: eventSchema.nullable(), leaders: z.array(leaderPreviewSchema).max(3).refine(rows => new Set(rows.map(row => row.workItemId)).size === rows.length), checkedAt: z.string(), expiresAt: z.string() }).refine(row => !row.recent || (row.recent.projectId === row.projectId && Number.isFinite(new Date(row.recent.at).getTime())), "Event must belong to its project and have a valid timestamp")).max(100);
