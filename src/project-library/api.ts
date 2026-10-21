import { getAuthToken } from "../api.ts";
import { cleanupResultSchema, missingProjectsSchema, type CleanupSelection } from "../../shared/project-library/cleanup.ts";
import { activitySchema, attentionSchema, clearedSchema, collectionSchema, eventsSchema, librarySchema, projectSchema, summariesSchema, unreadSchema, validateResponse } from "./response-schemas.ts";
import type { LibraryActivity, LibraryAttentionItem, LibraryEvent, LibraryEventPage, LibraryUnread, LibraryMetadataPatch, LibraryProject, LibrarySummary, ProjectLibrary, LibraryCollection } from "../../shared/project-library/index.ts";

export class LibraryApiError extends Error {
  code: string; status: number;
  constructor(message: string, code: string, status: number) { super(message); this.code = code; this.status = status; }
}
async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`/api/projects/library${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({})) as { error?: string; code?: string };
    throw new LibraryApiError(error.error ?? `Request failed (${res.status})`, error.code ?? "REQUEST_FAILED", res.status);
  }
  return res.json() as Promise<T>;
}
export const scanMissingFolders = async (projectIds: string[], signal?: AbortSignal) => validateResponse(missingProjectsSchema, await request("/missing-folders/scan", "POST", { projectIds }, signal));
export const cleanupMissingFolders = async (projects: CleanupSelection) => validateResponse(cleanupResultSchema, await request("/missing-folders/cleanup", "POST", { projects }));
const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;
export const getLibrary = async (signal?: AbortSignal): Promise<ProjectLibrary> => validateResponse(librarySchema, await request("", "GET", undefined, signal));
export const saveLibraryProject = async (id: string, patch: LibraryMetadataPatch): Promise<LibraryProject> => validateResponse(projectSchema, await request(projectPath(id), "PATCH", patch));
export const createCollection = async (name: string): Promise<LibraryCollection> => validateResponse(collectionSchema, await request("/collections", "POST", { name }));
export const renameCollection = async (id: string, name: string): Promise<LibraryCollection> => validateResponse(collectionSchema, await request(`/collections/${encodeURIComponent(id)}`, "PATCH", { name }));
export const deleteCollection = (id: string) => request<{ ok: true }>(`/collections/${encodeURIComponent(id)}`, "DELETE");
export const saveFocus = async (projectIds: string[], expectedRevision: number): Promise<ProjectLibrary> => validateResponse(librarySchema, await request("/focus", "PUT", { projectIds, expectedRevision }));
export const archiveProject = async (project: LibraryProject): Promise<LibraryProject> => validateResponse(projectSchema, await request(`${projectPath(project.id)}/archive`, "POST", { expectedRevision: project.revision }));
export const restoreProject = async (project: LibraryProject): Promise<LibraryProject> => validateResponse(projectSchema, await request(`${projectPath(project.id)}/restore`, "POST", { expectedRevision: project.revision }));
export const getLibraryEvents = async (id: string, cursor?: string): Promise<LibraryEventPage> => validateResponse(eventsSchema, await request(`${projectPath(id)}/events?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`));
export const getLibraryAttention = async (id: string, cursor?: string): Promise<{ items: LibraryAttentionItem[]; nextCursor: string | null }> => validateResponse(attentionSchema, await request(`${projectPath(id)}/attention?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`));
export const acknowledgeEvents = (id: string, page: LibraryEventPage, events: Array<Pick<LibraryEvent, "id" | "revision">> = page.events) => request<{ ok: true }>(`${projectPath(id)}/acknowledge`, "POST", { receipt: page.receipt, events: events.map(({ id, revision }) => ({ id, revision })) });
export const getLibraryUnread = async (signal?: AbortSignal): Promise<LibraryUnread> => validateResponse(unreadSchema, await request("/unread", "GET", undefined, signal));
/** Clears unread state up to `asOf` for the named projects, or every project when none are named. */
export const acknowledgeAll = async (input: { asOf: number; projectIds?: string[] }) => validateResponse(clearedSchema, await request("/acknowledge-all", "POST", input));
export async function getLibrarySummaries(projectIds: string[], signal?: AbortSignal) {
  const ids = [...new Set(projectIds)];
  const summaries: LibrarySummary[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    summaries.push(...validateResponse(summariesSchema, await request("/summary", "POST", { projectIds: ids.slice(offset, offset + 100) }, signal)));
  }
  return summaries;
}

/** Historical top-one metadata only; runtime hydration stays limited to visible rows/highlights. */
export async function getLibraryActivity(projectIds: string[], signal?: AbortSignal) {
  const ids = [...new Set(projectIds)], rows: LibraryActivity[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    rows.push(...validateResponse(activitySchema, await request("/activity", "POST", { projectIds: ids.slice(offset, offset + 100) }, signal)));
  }
  return rows;
}
