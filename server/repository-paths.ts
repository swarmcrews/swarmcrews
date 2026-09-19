import os from "node:os";
import path from "node:path";

export type RepositoryPlatform = "win32" | "posix";

export interface RepositoryPathOptions {
  platform?: RepositoryPlatform;
  homedir?: string;
}

function unquote(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const first = trimmed[0];
  if (first === "\"" || first === "'") {
    if (trimmed.length < 2 || trimmed.at(-1) !== first) return null;
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function windowsPathIsUnsafe(value: string): boolean {
  // Check before normalization can erase ambiguous segments. Both slash styles
  // have identical meaning on Windows, including in device/UNC prefixes.
  if (/^\\\\[?.]\\/u.test(value)) return true;
  if (!/^[a-z]:\\/iu.test(value) && !/^\\\\[^\\]+\\[^\\]+(?:\\|$)/u.test(value)) return true;
  const withoutDrive = value.replace(/^[a-z]:/iu, "");
  return withoutDrive.split("\\").some((segment) => {
    if (!segment || segment === "." || segment === "..") return false;
    return /[<>:"|?*\u0000-\u001f]/u.test(segment) || /[. ]$/u.test(segment)
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(segment);
  });
}

/**
 * Normalize a path supplied by a repository picker.  The platform is the
 * server platform, never the browser platform.  The optional platform makes
 * Windows grammar testable on non-Windows hosts.
 */
export function normalizeRepositoryPath(input: string, options: RepositoryPathOptions = {}): string | null {
  if (typeof input !== "string" || input.length > 32_768) return null;
  const platform = options.platform ?? (process.platform === "win32" ? "win32" : "posix");
  const api = platform === "win32" ? path.win32 : path.posix;
  const value = unquote(input);
  if (!value || value.includes("\0")) return null;

  if (platform === "win32") {
    const expanded = value === "~" || /^~[\\/]/u.test(value)
      ? `${options.homedir ?? os.homedir()}${value.slice(1)}`
      : value;
    const slashes = expanded.replaceAll("/", "\\");
    if (windowsPathIsUnsafe(slashes)) return null;
    return api.normalize(slashes);
  }

  // A Windows-looking value must never become a relative POSIX filename.
  if (/^[a-z]:/iu.test(value) || /^\\\\/u.test(value) || value.startsWith("\\")) return null;
  const expanded = value === "~" || value.startsWith("~/")
    ? api.join(options.homedir ?? os.homedir(), value.slice(1))
    : value;
  return api.isAbsolute(expanded) ? api.normalize(expanded) : null;
}
