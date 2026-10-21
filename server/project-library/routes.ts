import type { Router, Request, Response } from "express";
import { z } from "zod";
import type Database from "better-sqlite3";
import { persistenceDb } from "../session-persist.ts";
import { libraryAckAllSchema, libraryAckSchema, libraryCollectionSchema, libraryFocusSchema, libraryMetadataPatchSchema,
  libraryRevisionSchema, librarySummaryRequestSchema } from "../../shared/project-library/index.ts";
import { withLibrary, LibraryError, listLibrary, patchMetadata, setFocus, createCollection, deleteCollection } from "./store.ts";
import { summarizeLibrary, archiveProject, restoreProject, listAttention, type RuntimeReader } from "./summary.ts";
import { acknowledgeEvents, listEvents } from "./events.ts";
import { acknowledgeAll, unreadOverview } from "./read-state.ts";
import { recentLibraryActivity } from "./activity.ts";
import { cleanupSelectionSchema } from "../../shared/project-library/cleanup.ts";
import { scanMissingProjects, cleanupMissingProjects } from "./cleanup.ts";

const pageSchema = z.object({ cursor: z.string().max(2000).optional(), limit: z.coerce.number().int().min(1).max(50).default(50) }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new LibraryError(400, "VALIDATION_FAILED", "Invalid Library request");
  return result.data;
}
export function mountLibraryRoutes(router: Router, deps: {
  runtimeReader?: RuntimeReader; runtimeDb?: () => Database.Database | null;
} = {}) {
  const state = deps.runtimeDb ?? persistenceDb;
  const handle = (fn: (req: Request, db: Database.Database) => unknown) => (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(withLibrary(db => fn(req, db))); }
    catch (error) {
      if (error instanceof LibraryError) res.status(error.status).json({ error: error.message, code: error.code });
      else res.status(503).json({ error: "Library state unavailable; retry", code: "LIBRARY_UNAVAILABLE" });
    }
  };
  const id = (req: Request) => parse(z.string().uuid(), req.params["projectId"]);
  const collectionId = (req: Request) => parse(z.string().uuid(), req.params["collectionId"]);
  router.get("/library", handle((_req, db) => listLibrary(db)));
  router.post("/library/missing-folders/scan", handle((req, db) => scanMissingProjects(db, state(), deps.runtimeReader, parse(librarySummaryRequestSchema, req.body).projectIds)));
  router.post("/library/missing-folders/cleanup", handle((req, db) => cleanupMissingProjects(db, state(), deps.runtimeReader, parse(cleanupSelectionSchema, req.body).projects)));
  router.patch("/library/projects/:projectId", handle((req, db) => patchMetadata(db, id(req), parse(libraryMetadataPatchSchema, req.body))));
  router.put("/library/focus", handle((req, db) => { const body = parse(libraryFocusSchema, req.body); return setFocus(db, body.projectIds, body.expectedRevision); }));
  router.post("/library/collections", handle((req, db) => createCollection(db, parse(libraryCollectionSchema, req.body).name)));
  router.patch("/library/collections/:collectionId", handle((req, db) => {
    const name = parse(libraryCollectionSchema, req.body).name; const key = collectionId(req);
    if (!db.prepare("UPDATE library_collections SET name=? WHERE id=?").run(name, key).changes)
      throw new LibraryError(404, "NOT_FOUND", "Collection not found");
    return { id: key, name };
  }));
  router.delete("/library/collections/:collectionId", handle((req, db) => { deleteCollection(db, collectionId(req)); return { ok: true }; }));
  router.post("/library/activity", handle((req, db) => recentLibraryActivity(db, state(), parse(librarySummaryRequestSchema, req.body).projectIds)));
  router.post("/library/summary", handle((req, db) => summarizeLibrary(db, state(), deps.runtimeReader, parse(librarySummaryRequestSchema, req.body).projectIds)));
  router.get("/library/projects/:projectId/events", handle((req, db) => {
    const page = parse(pageSchema, req.query); return listEvents(db, state(), id(req), page.cursor, page.limit);
  }));
  router.post("/library/projects/:projectId/acknowledge", handle((req, db) => acknowledgeEvents(db, state(), id(req), parse(libraryAckSchema, req.body))));
  router.get("/library/unread", handle((_req, db) => unreadOverview(db, state())));
  router.post("/library/acknowledge-all", handle((req, db) => acknowledgeAll(db, state(), parse(libraryAckAllSchema, req.body))));
  router.get("/library/projects/:projectId/attention", handle(req => {
    const page = parse(pageSchema, req.query); const runtime = state();
    if (!runtime) throw new LibraryError(503, "STATE_UNAVAILABLE", "Work state unavailable");
    return listAttention(runtime, id(req), page.cursor, page.limit);
  }));
  router.post("/library/projects/:projectId/archive", handle((req, db) => archiveProject(db, state(), deps.runtimeReader, id(req), parse(libraryRevisionSchema, req.body).expectedRevision)));
  router.post("/library/projects/:projectId/restore", handle((req, db) => restoreProject(db, id(req), parse(libraryRevisionSchema, req.body).expectedRevision)));
}
