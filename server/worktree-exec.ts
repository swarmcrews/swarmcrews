import { execFile as execFileCb } from "node:child_process";

export const WORKTREE_DIR = ".canvas-worktrees";

// Git listings routinely exceed Node's 1 MiB default in asset-heavy projects.
// Keep a finite ceiling: callers must never parse a truncated success result.
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_DIAGNOSTIC_CHARS = 2048;

function diagnostic(message: string): string {
  const text = message.replace(/\0/g, "\\n").trim();
  return text.length > MAX_DIAGNOSTIC_CHARS
    ? `${text.slice(0, MAX_DIAGNOSTIC_CHARS)}… [truncated]`
    : text;
}

export function exec(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb("git", args, { cwd, maxBuffer: MAX_GIT_OUTPUT_BYTES }, (error, stdout, stderr) => {
      if (error) {
        // Partial stdout is data, not the reason the process failed. In particular,
        // ls-files overflow used to expose a megabyte of filenames as the error.
        const msg = error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
          ? "output exceeded the 16 MiB safety limit. Narrow the review scope or exclude generated artifacts using .gitignore or .git/info/exclude, then retry."
          : diagnostic(stderr?.trim() || stdout?.trim() || error.message);
        reject(new Error(`git ${args[0]}: ${msg}`, { cause: error }));
      } else {
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      }
    });
  });
}
