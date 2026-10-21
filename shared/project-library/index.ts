import { z } from "zod";

export const LIBRARY_BATCH_SIZE = 100;
export const LIBRARY_EVENT_PAGE_SIZE = 50;
const uuid = z.string().uuid();
const label = z.string().trim().min(1).max(200);
export const libraryMetadataPatchSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  displayName: label.nullable().optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(label).max(30).optional(),
  collectionIds: z.array(uuid).max(100).optional(),
}).strict();
export const libraryCollectionSchema = z.object({ name: label }).strict();
export const libraryFocusSchema = z.object({ projectIds: z.array(uuid).max(100),
  expectedRevision: z.number().int().nonnegative() }).strict();
export const librarySummaryRequestSchema = z.object({ projectIds: z.array(uuid).max(LIBRARY_BATCH_SIZE) }).strict();
export const libraryRevisionSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export const libraryAckSchema = z.object({ receipt: z.string().min(1).max(20000),
  events: z.array(z.object({ id: z.string().min(1).max(200), revision: z.number().int().nonnegative() }).strict()).max(50) }).strict();
/** Bulk read-state clear: only events at or before `asOf` are touched, so later arrivals stay unread. */
export const libraryAckAllSchema = z.object({ asOf: z.number().int().nonnegative(),
  projectIds: z.array(uuid).min(1).max(LIBRARY_BATCH_SIZE).optional() }).strict();
export interface LibraryProject {
  id: string; workspaceId: string; sourceRoot: string; path: string;
  name: string; displayName: string | null; description: string; tags: string[];
  collectionIds: string[]; archived: boolean; focusOrder: number | null;
  revision: number; createdAt: string; lastOpened: string | null;
}
export interface LibraryCollection { id: string; name: string }
export interface ProjectLibrary { projects: LibraryProject[]; collections: LibraryCollection[]; focusRevision: number }
/** Work updates represent the latest event per primary leader conversation;
 * continuations share WorkItem identity. Context updates remain separate events. */
export interface LibraryEvent {
  id: string; revision: number; projectId: string; workItemId: string | null;
  kind: "work_item" | "context"; text: string; at: number; unread: boolean;
  destination: { view: "activity"; workItemId: string } | { view: "context" };
}
/** Lightweight historical index; never runtime or archive authority. */
export interface LibraryLeaderPreview { workItemId: string; title: string; at: number }
export interface LibraryActivity { projectId: string; recent: LibraryEvent | null; leaders: LibraryLeaderPreview[]; checkedAt: string; expiresAt: string }
export interface LibraryEventPage { events: LibraryEvent[]; receipt: string; nextCursor: string | null }
/** Unread leader conversations plus separate context updates, not raw lifecycle transitions. */
export interface LibraryUnread { total: number; projects: number; asOf: number }
export interface LibraryAttentionItem {
  workItemId: string; title: string; revision: number; currentRunKey: string | null;
  categories: Array<"decision" | "review" | "conflict">;
}
export interface LibrarySummary {
  projectId: string; freshness: "fresh" | "unknown"; checkedAt: string; expiresAt: string;
  state: "attention" | "running" | "new" | "up_to_date" | "unknown";
  activeLeaders: number | null; activeCrew: number | null; activeOther: number | null;
  activeWorkItems: number | null;
  /** Actual execution, separate from unresolved/waiting work counted above. */
  running?: boolean | null | undefined;
  runningLeaders?: number | null | undefined;
  attention: { total: number; decision: number; review: number; conflict: number } | null;
  unread: number | null; recent: LibraryEvent | null;
  archiveEligible: boolean;
}
export type LibraryMetadataPatch = z.infer<typeof libraryMetadataPatchSchema>;

/** Client-side stale display uses the shared batched refresh clock, not per-card timers. */
export function librarySummaryFreshness(summary: Pick<LibrarySummary, "freshness" | "expiresAt">, now = Date.now()): "fresh" | "stale" | "unknown" {
  if (summary.freshness !== "fresh") return "unknown";
  const expires = Date.parse(summary.expiresAt);
  return !Number.isFinite(expires) ? "unknown" : expires <= now ? "stale" : "fresh";
}
