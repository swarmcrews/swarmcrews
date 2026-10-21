import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getSwarmcrewsHome, listWorkspaces, resolveWorkspace, canonicalizeSourceRoot, type WorkspaceBinding } from "../workspace-registry.ts";
import type { LibraryMetadataPatch, LibraryProject, ProjectLibrary } from "../../shared/project-library/index.ts";

export class LibraryError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function authorizeWorkspace(id: string) {
  const workspace = resolveWorkspace(id);
  if (!workspace) throw new LibraryError(403, "NOT_REGISTERED", "Registered workspace UUID required");
  // Never follow a source that has been replaced with a symlink to a different root.
  if (canonicalizeSourceRoot(workspace.sourceRoot) !== workspace.sourceRoot)
    throw new LibraryError(403, "SOURCE_CHANGED", "Explicit source rebind required");
  return workspace;
}
/** Registration-only lookup for projections that degrade changed sources to unknown.
 * This does not authorize source access; callers must separately validate each root. */
export function registeredWorkspaces(ids: string[]): WorkspaceBinding[] {
  const registered = new Map(listWorkspaces().map(workspace => [workspace.id, workspace]));
  return ids.map(id => {
    const workspace = registered.get(id);
    if (!workspace) throw new LibraryError(403, "NOT_REGISTERED", "Registered workspace UUID required");
    return workspace;
  });
}
export function authorizeWorkspaces(ids: string[]): WorkspaceBinding[] {
  return registeredWorkspaces(ids).map(workspace => {
    if (canonicalizeSourceRoot(workspace.sourceRoot) !== workspace.sourceRoot)
      throw new LibraryError(403, "SOURCE_CHANGED", "Explicit source rebind required");
    return workspace;
  });
}
export function withLibrary<T>(operation: (db: Database.Database) => T): T {
  const home = getSwarmcrewsHome();
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(home).isSymbolicLink()) throw new Error("Library home must be a real directory");
  const file = path.join(home, "project-library.db");
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Library DB must not be a symlink");
  const db = new Database(file);
  try {
    db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS library_projects (
        id TEXT PRIMARY KEY, display_name TEXT, description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]', collections TEXT NOT NULL DEFAULT '[]',
        archived INTEGER NOT NULL DEFAULT 0, focus_order INTEGER,
        revision INTEGER NOT NULL DEFAULT 0, last_opened TEXT
      );
      CREATE TABLE IF NOT EXISTS library_collections (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS library_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO library_meta VALUES ('focus_revision','0');
      CREATE TABLE IF NOT EXISTS library_context_events (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
        text TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS library_context_recent ON library_context_events(project_id, at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS library_ack (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
    `);
    return operation(db);
  } finally { db.close(); }
}
interface MetadataRow {
  id: string; display_name: string | null; description: string; tags: string; collections: string;
  archived: number; focus_order: number | null; revision: number; last_opened: string | null;
}
export function ensureEntry(db: Database.Database, id: string): MetadataRow {
  authorizeWorkspace(id);
  db.prepare("INSERT OR IGNORE INTO library_projects(id) VALUES (?)").run(id);
  return db.prepare("SELECT * FROM library_projects WHERE id = ?").get(id) as MetadataRow;
}
export function projectFromRow(row: MetadataRow, workspace = resolveWorkspace(row.id)!): LibraryProject {
  return { id: row.id, workspaceId: row.id, sourceRoot: workspace.sourceRoot, path: workspace.sourceRoot,
    name: row.display_name ?? workspace.nickname, displayName: row.display_name, description: row.description,
    tags: JSON.parse(row.tags), collectionIds: JSON.parse(row.collections), archived: !!row.archived,
    focusOrder: row.focus_order, revision: row.revision, createdAt: workspace.createdAt, lastOpened: row.last_opened };
}
export function listLibrary(db: Database.Database): ProjectLibrary {
  const projects = listWorkspaces().map(workspace => {
    // Keep missing/changed sources visible for recovery, but forbid writes to changed roots.
    db.prepare("INSERT OR IGNORE INTO library_projects(id) VALUES (?)").run(workspace.id);
    return projectFromRow(db.prepare("SELECT * FROM library_projects WHERE id = ?").get(workspace.id) as MetadataRow, workspace);
  });
  return { projects, collections: db.prepare("SELECT id,name FROM library_collections ORDER BY name,id").all() as ProjectLibrary["collections"],
    focusRevision: focusRevision(db) };
}
export function focusRevision(db: Database.Database): number {
  return Number((db.prepare("SELECT value FROM library_meta WHERE key='focus_revision'").get() as { value: string }).value);
}
export function bumpFocus(db: Database.Database) {
  db.prepare("UPDATE library_meta SET value = CAST(value AS INTEGER)+1 WHERE key='focus_revision'").run();
}
export function assertRevision(actual: number, expected: number) {
  if (actual !== expected) throw new LibraryError(409, "REVISION_CONFLICT", "Organization changed; refetch before saving");
}
export function patchMetadata(db: Database.Database, id: string, input: LibraryMetadataPatch): LibraryProject {
  return db.transaction(() => {
    const row = ensureEntry(db, id); assertRevision(row.revision, input.expectedRevision);
    for (const collectionId of input.collectionIds ?? []) {
      if (!db.prepare("SELECT id FROM library_collections WHERE id=?").get(collectionId))
        throw new LibraryError(400, "COLLECTION_NOT_FOUND", "Collection no longer exists");
    }
    db.prepare(`UPDATE library_projects SET display_name=?, description=?, tags=?, collections=?, revision=revision+1 WHERE id=?`)
      .run(input.displayName === undefined ? row.display_name : input.displayName,
        input.description ?? row.description,
        input.tags ? JSON.stringify([...new Set(input.tags)]) : row.tags,
        input.collectionIds ? JSON.stringify([...new Set(input.collectionIds)]) : row.collections, id);
    return projectFromRow(ensureEntry(db, id));
  }).immediate();
}
export function setFocus(db: Database.Database, ids: string[], expected: number) {
  return db.transaction(() => {
    assertRevision(focusRevision(db), expected);
    if (new Set(ids).size !== ids.length) throw new LibraryError(400, "DUPLICATE_ID", "Focus IDs must be unique");
    for (const id of ids) if (ensureEntry(db, id).archived)
      throw new LibraryError(409, "ARCHIVED", "Restore project before adding to Focus");
    db.prepare("UPDATE library_projects SET focus_order=NULL, revision=revision+1 WHERE focus_order IS NOT NULL").run();
    ids.forEach((id, i) => db.prepare("UPDATE library_projects SET focus_order=?,revision=revision+1 WHERE id=?").run(i, id));
    bumpFocus(db); return listLibrary(db);
  }).immediate();
}
export function createCollection(db: Database.Database, name: string) {
  const id = crypto.randomUUID(); db.prepare("INSERT INTO library_collections VALUES (?,?)").run(id, name); return { id, name };
}
export function deleteCollection(db: Database.Database, id: string) {
  db.transaction(() => {
    if (!db.prepare("SELECT id FROM library_collections WHERE id=?").get(id))
      throw new LibraryError(404, "NOT_FOUND", "Collection not found");
    const rows = db.prepare("SELECT id,collections FROM library_projects").all() as Array<{ id: string; collections: string }>;
    for (const row of rows) {
      const old = JSON.parse(row.collections) as string[];
      if (old.includes(id)) db.prepare("UPDATE library_projects SET collections=?,revision=revision+1 WHERE id=?")
        .run(JSON.stringify(old.filter(value => value !== id)), row.id);
    }
    db.prepare("DELETE FROM library_collections WHERE id=?").run(id);
  }).immediate();
}
export function recordOpened(id: string, at = new Date().toISOString()) {
  // Identity/source authorization must not depend on optional Library availability.
  authorizeWorkspace(id);
  withLibrary(db => { ensureEntry(db, id); db.prepare("UPDATE library_projects SET last_opened=CASE WHEN last_opened IS NULL OR last_opened<? THEN ? ELSE last_opened END WHERE id=?").run(at, at, id); });
}
/** Recents are optional, at startup and when opening core project state. Only
 * classified SQLite storage failures degrade; identity, symlink, permission and
 * programming errors remain fatal. Never replace or repair failed Library data. */
export function recordOpenedIfAvailable(id: string, at?: string): void {
  try { recordOpened(id, at); }
  catch (error) {
    if (!(error instanceof Database.SqliteError)
      || !/^SQLITE_(NOTADB|CORRUPT|FULL|BUSY|LOCKED)(_|$)/.test(error.code)) throw error;
    console.error("Library opening history unavailable; existing state retained", error.code);
  }
}
export function recordContextChangedInDb(db: Database.Database, id: string, content: string, force = false) {
  ensureEntry(db, id);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const key = `context_hash:${id}`;
  const previous = db.prepare("SELECT value FROM library_meta WHERE key=?").get(key) as { value: string } | undefined;
  if (!force && previous?.value === hash) return;
  db.prepare("INSERT OR REPLACE INTO library_meta VALUES (?,?)").run(key, hash);
  db.prepare("INSERT INTO library_context_events VALUES (?,?,?,?,?)")
    .run(crypto.randomUUID(), id, 0, "Project context updated", Date.now());
}
export function recordContextChanged(id: string, content: string) {
  withLibrary(db => db.transaction(() => recordContextChangedInDb(db, id, content)).immediate());
}
