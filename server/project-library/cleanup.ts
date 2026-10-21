import fs from "node:fs";
import type Database from "better-sqlite3";
import type { CleanupResult, CleanupSelection, MissingProject } from "../../shared/project-library/cleanup.ts";
import { authorizeWorkspace, assertRevision, bumpFocus, ensureEntry, LibraryError } from "./store.ts";
import { missingSourceArchiveEligibility, type RuntimeReader } from "./summary.ts";

/** Only ENOENT is evidence of absence. A dangling symlink, file, permission error,
 * or unavailable filesystem is not permission to clean up a project. */
export function sourceIsMissing(source: string): boolean {
  try { fs.lstatSync(source); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
}
export function scanMissingProjects(db: Database.Database, runtime: Database.Database | null,
  reader: RuntimeReader | undefined, ids: string[]): MissingProject[] {
  const candidates: MissingProject[] = [];
  for (const id of ids) {
    try {
      const workspace = authorizeWorkspace(id); const row = ensureEntry(db, id);
      if (!row.archived && sourceIsMissing(workspace.sourceRoot)) candidates.push({ id, revision: row.revision, eligible: false });
    } catch (error) { if (!(error instanceof LibraryError)) throw error; }
  }
  const eligibility = missingSourceArchiveEligibility(db, runtime, reader, candidates.map(p => p.id));
  return candidates.map(p => ({ ...p, eligible: eligibility.get(p.id) === true }));
}
export function cleanupMissingProjects(db: Database.Database, runtime: Database.Database | null,
  reader: RuntimeReader | undefined, projects: CleanupSelection): CleanupResult {
  const result: CleanupResult = { archived: [], skipped: [] };
  for (const project of projects) {
    try {
      if (!runtime || !reader) throw new LibraryError(409, "CLEANUP_UNSAFE", "Fresh authoritative work state unavailable");
      // Match normal archive's fence: durable work cannot arrive between validation and write.
      runtime.transaction(() => db.transaction(() => {
        const workspace = authorizeWorkspace(project.id); const row = ensureEntry(db, project.id);
        assertRevision(row.revision, project.expectedRevision);
        if (row.archived) throw new LibraryError(409, "ALREADY_ARCHIVED", "Project is already archived; scan again");
        if (!sourceIsMissing(workspace.sourceRoot)) throw new LibraryError(409, "SOURCE_PRESENT", "Folder is no longer confirmed missing");
        if (!missingSourceArchiveEligibility(db, runtime, reader, [project.id]).get(project.id))
          throw new LibraryError(409, "CLEANUP_UNSAFE", "Active, unresolved or unknown work blocks cleanup");
        // Recheck identity and absence after the runtime read, immediately before the write.
        const current = authorizeWorkspace(project.id);
        if (current.sourceRoot !== workspace.sourceRoot || !sourceIsMissing(current.sourceRoot))
          throw new LibraryError(409, "SOURCE_CHANGED", "Folder changed since the scan; scan again");
        db.prepare("UPDATE library_projects SET archived=1,focus_order=NULL,revision=revision+1 WHERE id=?").run(project.id);
        if (row.focus_order !== null) bumpFocus(db);
      }).immediate()).immediate();
      result.archived.push(project.id);
    } catch (error) {
      if (!(error instanceof LibraryError)) throw error;
      result.skipped.push({ id: project.id, reason: error.message });
    }
  }
  return result;
}
