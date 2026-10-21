import type { Router } from "express";
import { canonicalizeSourceRoot, resolveWorkspace } from "../workspace-registry.ts";

/** Preserve UUID identity when a formerly registered source is replaced by a
 * symlink to another (even independently registered) repository. Legacy route
 * helpers otherwise canonicalize into that other root's path allowlist.
 */
export function mountWorkspaceIdentityGuard(router: Router) {
  router.use("/:encodedPath", (req, res, next) => {
    const key = req.params["encodedPath"];
    const workspace = typeof key === "string" ? resolveWorkspace(key) : null;
    if (workspace && canonicalizeSourceRoot(workspace.sourceRoot) !== workspace.sourceRoot) {
      res.status(403).json({ code: "SOURCE_CHANGED", error: "Explicit workspace rebind required" }); return;
    }
    next();
  });
}
