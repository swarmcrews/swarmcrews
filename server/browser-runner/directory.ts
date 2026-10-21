import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

export interface SourceDirectory { readonly fd: number; close(): void }
export function requireProtectedOwner(stat: { uid: number; mode: number }): void {
  if (stat.uid !== 0 || (stat.mode & 0o022) !== 0) throw new Error("Browser policy requires root-owned, non-group/world-writable ancestry and file");
}
/** Pin every path component before opening its child. O_NOFOLLOW on just the
 * final absolute path is insufficient: a writable ancestor could be swapped.
 * Linux proc-fd traversal retains directory identity even across renames.
 */
export function openSourceDirectory(path: string, protectedAncestry = false): SourceDirectory {
  if (process.platform !== "linux" || !isAbsolute(path) || normalize(path) !== path) throw new Error("Canonical Linux directory required");
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  let fd = openSync("/", flags);
  try {
    if (protectedAncestry) requireProtectedOwner(fstatSync(fd));
    for (const component of path.split("/").filter(Boolean)) {
      const next = openSync(`/proc/self/fd/${fd}/${component}`, flags);
      closeSync(fd); fd = next;
      if (protectedAncestry) requireProtectedOwner(fstatSync(fd));
    }
    let closed = false;
    return { fd, close: () => { if (!closed) { closed = true; closeSync(fd); } } };
  } catch (error) { closeSync(fd); throw error; }
}
