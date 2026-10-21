import { constants, closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import { z } from "zod/v4";
import { openSourceDirectory, requireProtectedOwner } from "./directory.ts";
import { sourceExclusionsSchema } from "./snapshot-exclusions.ts";

const pathSchema = z.string().min(1).max(4096).refine(isAbsolute, "Absolute path required");
export const grantSchema = z.object({
  sessionKey: z.string().min(1).max(200), projectPath: pathSchema,
  worktrees: z.array(pathSchema).min(1).max(32),
  suites: z.array(z.enum(["smoke", "e2e"])).min(1).max(2),
  expiresAt: z.number().int().positive(), manage: z.boolean().default(false),
}).strict();
export const runnerSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  image: z.string().max(300).regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9./:_-]*@)?sha256:[a-f0-9]{64}$/),
  maxConcurrent: z.number().int().min(1).max(4).default(1),
  timeoutSeconds: z.number().int().min(10).max(900).default(300),
  memoryMb: z.number().int().min(512).max(8192).default(2048),
  cpus: z.number().min(0.25).max(4).default(2),
  pids: z.number().int().min(64).max(1024).default(256),
  workspaceMb: z.number().int().min(64).max(1024).default(256),
  sourceExclusions: sourceExclusionsSchema,
  grants: z.array(grantSchema).max(128),
}).strict();
export const browserPolicySchema = z.object({
  version: z.literal(1), maxConcurrent: z.number().int().min(1).max(8).default(2),
  runners: z.array(runnerSchema).max(16),
}).strict().superRefine((policy, ctx) => {
  if (new Set(policy.runners.map(r => r.id)).size !== policy.runners.length) ctx.addIssue({ code: "custom", message: "Duplicate runner" });
  for (const r of policy.runners) if (new Set(r.grants.map(g => g.sessionKey)).size !== r.grants.length) ctx.addIssue({ code: "custom", message: "Duplicate session grant" });
});
export type BrowserPolicy = z.infer<typeof browserPolicySchema>;
export type BrowserRunner = z.infer<typeof runnerSchema>;
export type BrowserGrant = z.infer<typeof grantSchema>;
export type BrowserPrincipal = { sessionKey: string; projectPath: string; cwd: string };
export function within(root: string, path: string): boolean {
  const rel = relative(root, path); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
/** Operator-owned file, never a project setting or tool argument. Read afresh for revocation. */
export function loadBrowserPolicy(file = process.env.SWARMCREWS_BROWSER_POLICY): BrowserPolicy {
  if (!file) return { version: 1, maxConcurrent: 2, runners: [] };
  if (!isAbsolute(file)) throw new Error("Browser policy must have an absolute path");
  const parent = openSourceDirectory(dirname(file), true);
  let fd: number;
  try { fd = openSync(`/proc/self/fd/${parent.fd}/${basename(file)}`, constants.O_RDONLY | constants.O_NOFOLLOW); }
  finally { parent.close(); }
  try {
    const stat = fstatSync(fd);
    requireProtectedOwner(stat);
    if (!stat.isFile() || stat.size > 262144 || stat.nlink !== 1) throw new Error("Unsafe browser policy file");
    const buffer = Buffer.alloc(262145);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length > 262144) throw new Error("Browser policy too large");
    const policy = browserPolicySchema.parse(JSON.parse(buffer.subarray(0, length).toString("utf8")));
    const policyPath = realpathSync(file);
    for (const runner of policy.runners) for (const grant of runner.grants) {
      for (const root of [grant.projectPath, ...grant.worktrees]) {
        if (realpathSync(root) !== root || !statSync(root).isDirectory()) throw new Error("Policy roots must be canonical directories");
        if (within(root, policyPath)) throw new Error("Browser policy must be outside every project/worktree");
      }
    }
    return policy;
  } finally { closeSync(fd); }
}
export function canonicalPrincipal(principal: BrowserPrincipal): BrowserPrincipal {
  return { ...principal, cwd: realpathSync(principal.cwd), projectPath: realpathSync(principal.projectPath) };
}
export function matchesGrant(grant: BrowserGrant, principal: BrowserPrincipal, now: number): boolean {
  return grant.sessionKey === principal.sessionKey && grant.projectPath === principal.projectPath
    && grant.worktrees.includes(principal.cwd) && grant.expiresAt > now;
}
