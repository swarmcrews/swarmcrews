import { z } from "zod/v4";

// Operator-selected literal root entry names, never gitignore/glob/path expressions.
export const sourceExclusionsSchema = z.array(z.string().min(1).max(128)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine(name => name !== "." && name !== "..", "Root entry name required"))
  .max(32).default([]);

const ALWAYS = new Set([".git", "node_modules", ".scratch", ".minions", ".swarmcrews", ".npmrc", ".yarnrc", "playwright-report", "test-results"]);
const ROOT_RUNTIME = new Set([".run", ".canvas-worktrees", ".context", ".recovery", ".stryker-tmp", "__dag_verify__"]);

/** Do not open excluded entries, including symlinks. Generic names remain source
 * unless explicitly excluded by the operator, and then only at the root. */
export function excludesSnapshotEntry(name: string, atRoot: boolean, rootExclusions: ReadonlySet<string>): boolean {
  return ALWAYS.has(name) || name.startsWith(".env") || name.startsWith(".minions-mcp-launch-") || name.startsWith(".swarmcrews-")
    || (atRoot && (ROOT_RUNTIME.has(name) || rootExclusions.has(name)));
}
