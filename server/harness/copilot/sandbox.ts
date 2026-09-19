import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import type { CopilotSession, SessionHooks } from "@github/copilot-sdk";
import type { HarnessStartOptions } from "../types.ts";

type SandboxConfig = NonNullable<Parameters<CopilotSession["rpc"]["options"]["update"]>[0]["sandboxConfig"]>;

export function copilotFilesystemScope(opts: HarnessStartOptions) {
  return opts.sandboxPolicy?.requested.filesystemScope
    ?? (opts.permissionMode === "plan" ? "read-only" : "workspace-write");
}

/** Per-session policy: never mutate the user's persisted Copilot settings. */
export function copilotSandboxConfig(opts: HarnessStartOptions): SandboxConfig {
  const scope = copilotFilesystemScope(opts);
  if (scope === "unrestricted") return { enabled: false };
  const cwd = realpathSync.native(opts.cwd);
  return {
    enabled: true, allowBypass: false, addCurrentWorkingDirectory: false,
    allowDevToolAccess: false, sandboxMcpServers: true, sandboxLspServers: true,
    userPolicy: {
      filesystem: {
        // Filesystem scope limits writes, not reads. Disable automatic developer
        // cache grants so a workspace policy cannot silently gain external writes.
        readonlyPaths: [path.parse(cwd).root, ...(scope === "read-only" ? [cwd] : []),
          ...[".git", ".agents", ".codex"].map(name => path.join(cwd, name)).filter(existsSync)],
        readwritePaths: scope === "workspace-write" ? [cwd] : [],
      },
    },
  };
}

/** Reapply on cold resume, before the first prompt or native tool execution. */
export async function applyCopilotSandbox(session: CopilotSession, opts: HarnessStartOptions): Promise<void> {
  try {
    const result = await session.rpc.options.update({ sandboxConfig: copilotSandboxConfig(opts) });
    if (!result.success) throw new Error("Runtime rejected the sandbox policy.");
    const status = await session.rpc.sandbox.getEnforcementStatus();
    if (status.blocked) throw new Error(status.reason ?? "Sandbox enforcement blocked.");
  } catch (error) {
    throw new Error(`Copilot could not enforce the requested sandbox policy: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Resolve missing leaves through their real existing ancestor; fail closed on dangling links. */
function canonicalWritePath(candidate: string): string {
  try { lstatSync(candidate); return realpathSync.native(candidate); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A dangling symlink exists, but its real target does not.
    try { if (lstatSync(candidate).isSymbolicLink()) throw new Error("Dangling symbolic link"); }
    catch (statError) { if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError; }
    const parent = path.dirname(candidate);
    if (parent === candidate) throw error;
    return path.join(canonicalWritePath(parent), path.basename(candidate));
  }
}

export function copilotWriteAllowed(opts: HarnessStartOptions, fileName: unknown): boolean {
  const scope = copilotFilesystemScope(opts);
  if (scope === "read-only" || typeof fileName !== "string" || !fileName.trim()) return false;
  if (scope === "unrestricted") return true;
  try {
    const cwd = realpathSync.native(opts.cwd);
    // Preserve `link/..` until realpath resolves it. Lexical normalization first
    // would misclassify traversal through an external symlink as an in-root path.
    const target = canonicalWritePath(path.isAbsolute(fileName) ? fileName : `${cwd}${path.sep}${fileName}`);
    const relative = path.relative(cwd, target);
    return relative !== "" && !path.isAbsolute(relative) && relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && ![".git", ".agents", ".codex"].includes(relative.split(path.sep)[0]!);
  } catch { return false; }
}

/** Native file tools run in the CLI process; check their paths before execution too. */
export function copilotSandboxHooks(opts: HarnessStartOptions, signal: AbortSignal): SessionHooks {
  return { onPreToolUse: (input) => {
    if (signal.aborted) return { permissionDecision: "deny", permissionDecisionReason: "Run has ended." };
    const name = input.toolName.replace(/^builtin:/, "");
    if (name !== "create" && name !== "edit") return;
    const args = input.toolArgs as { path?: unknown } | null;
    if (!copilotWriteAllowed(opts, args?.path)) return {
      permissionDecision: "deny", permissionDecisionReason: "Write exceeds the requested filesystem scope.",
    };
    // Leave ordinary/managed approval decisions to the permission handler.
    return;
  } };
}
