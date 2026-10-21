import fs from "node:fs";
import { findWorkspaceBySource, registerWorkspace } from "../workspace-registry.ts";
import { withLibrary, recordContextChangedInDb } from "./store.ts";

/** Open/check event persistence before modifying source instructions. FS failures
 * roll back the event, and event-write failures leave the source untouched.
 * No instruction body is persisted in the Library, only a digest + generic label.
 */
export function writeTrackedContext(projectPath: string, contextPath: string, content: string) {
  const workspace = findWorkspaceBySource(projectPath) ?? registerWorkspace(projectPath);
  if (!workspace) throw new Error("Context requires a registered workspace");
  withLibrary(db => db.transaction(() => {
    const changed = !fs.existsSync(contextPath) || fs.readFileSync(contextPath, "utf8") !== content;
    if (changed) recordContextChangedInDb(db, workspace.id, content, true);
    fs.writeFileSync(contextPath, content);
  }).immediate());
}
