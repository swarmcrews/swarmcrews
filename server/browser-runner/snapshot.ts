import { constants } from "node:fs";
import { mkdtemp, mkdir, open, opendir, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openSourceDirectory, type SourceDirectory } from "./directory.ts";
import { excludesSnapshotEntry, sourceExclusionsSchema } from "./snapshot-exclusions.ts";
export interface SourceSnapshot { directory: string; digest: string; files: number; bytes: number; dispose(): Promise<void> }
/** Linux fd-relative traversal: no symlink traversal, even if directories are swapped during copying.
 * Sources are data only. No git commands, project hooks or package scripts run on the host.
 */
export async function snapshotSource(cwd: string | SourceDirectory, signal: AbortSignal, sourceExclusions: readonly string[] = []): Promise<SourceSnapshot> {
  signal.throwIfAborted();
  const rootExclusions = new Set(sourceExclusionsSchema.parse(sourceExclusions));
  const root = typeof cwd === "string" ? openSourceDirectory(cwd) : cwd;
  let directory: string;
  try { directory = await mkdtemp(join(tmpdir(), "swarm-browser-")); }
  catch (error) { if (typeof cwd === "string") root.close(); throw error; }
  const digest = createHash("sha256"); let files = 0; let bytes = 0;
  const walk = async (source: FileHandle | SourceDirectory, destination: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 40) throw new Error("Browser source directory depth exceeded");
    const names: string[] = [];
    for await (const entry of await opendir(`/proc/self/fd/${source.fd}`)) {
      signal.throwIfAborted();
      if (names.length >= 10000) throw new Error("Browser source directory entry limit exceeded");
      names.push(entry.name);
    }
    for (const name of names.sort()) {
      signal.throwIfAborted();
      if (excludesSnapshotEntry(name, depth === 0, rootExclusions)) continue;
      if (++files > 10000) throw new Error("Browser source file limit exceeded");
      const handle = await open(`/proc/self/fd/${source.fd}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat(); const path = `${prefix}${name}`;
        if (stat.isDirectory()) {
          digest.update(JSON.stringify([`${path}/`, "directory"]));
          await mkdir(join(destination, name)); await walk(handle, join(destination, name), `${path}/`, depth + 1);
        } else if (stat.isFile()) {
          if (stat.nlink !== 1) throw new Error("Browser source hardlinks are not permitted");
          if (stat.size > 16 * 1024 * 1024 || bytes + stat.size > 64 * 1024 * 1024) throw new Error("Browser source byte limit exceeded");
          // Bounded reads also cover concurrently growing source files.
          const data = Buffer.alloc(stat.size + 1); const { bytesRead } = await handle.read(data, 0, data.length, 0);
          if (bytesRead !== stat.size) throw new Error("Browser source changed during snapshot; retry after edits finish");
          const content = data.subarray(0, bytesRead); bytes += bytesRead;
          digest.update(JSON.stringify([path, bytesRead, stat.mode & 0o111])); digest.update(content);
          await writeFile(join(destination, name), content, { mode: stat.mode & 0o111 ? 0o755 : 0o644, flag: "wx" });
        } else throw new Error("Browser source contains non-regular files");
      } finally { await handle.close(); }
    }
  };
  try {
    await walk(root, directory, "", 0);
    return { directory, digest: digest.digest("hex"), files, bytes, dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  finally { if (typeof cwd === "string") root.close(); }
}
