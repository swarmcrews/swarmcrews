import fs from "node:fs/promises";
import type { Dir } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RepositoryDirectory, RepositoryPathRequest, RepositoryPathSuggestions } from "../shared/repository-paths.ts";
import { normalizeRepositoryPath } from "./repository-paths.ts";

const MAX_ENTRIES = 100;
const MAX_SCANNED = 2_000;
const SCAN_TIME_MS = 1_000;

interface Root { path: string; real: string }

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function configuredRoots(): Promise<Root[]> {
  let values: string[] = [os.homedir()];
  if (process.env.SWARMCREWS_BROWSE_ROOTS !== undefined) {
    try {
      const parsed: unknown = JSON.parse(process.env.SWARMCREWS_BROWSE_ROOTS);
      if (!Array.isArray(parsed) || parsed.length > 32 || !parsed.every((item) => typeof item === "string")) return [];
      values = parsed;
    } catch { return []; }
  }
  const roots = await Promise.all(values.map(async (value) => {
    const normalized = normalizeRepositoryPath(value);
    if (!normalized) return null;
    try {
      const real = await fs.realpath(normalized);
      return (await fs.stat(real)).isDirectory() ? { path: normalized, real } : null;
    } catch { return null; }
  }));
  return roots.filter((root): root is Root => root !== null);
}

function rootDirectory(root: Root): RepositoryDirectory {
  return { name: path.basename(root.real) || root.real, path: root.real };
}

function inScope(candidate: string, roots: Root[]): boolean {
  // Keep configured aliases as well as canonical names: /tmp and /var on macOS
  // commonly resolve through /private, and Windows roots may be junctions.
  return roots.some((root) => inside(root.path, candidate) || inside(root.real, candidate));
}

async function safeRealDirectory(candidate: string, roots: Root[]): Promise<string | null> {
  if (!inScope(candidate, roots)) return null;
  try {
    const real = await fs.realpath(candidate);
    if (!roots.some((root) => inside(root.real, real))) return null;
    if (!(await fs.stat(real)).isDirectory()) return null;
    return real;
  } catch { return null; }
}

function trail(directory: string, roots: Root[]): { parent: string | null; breadcrumbs: RepositoryDirectory[] } {
  const root = roots.filter((item) => inside(item.real, directory)).sort((a, b) => b.real.length - a.real.length)[0];
  if (!root) return { parent: null, breadcrumbs: [] };
  const names = path.relative(root.real, directory).split(path.sep).filter(Boolean);
  const breadcrumbs = [rootDirectory(root)];
  let current = root.real;
  for (const name of names) {
    current = path.join(current, name);
    breadcrumbs.push({ name, path: current });
  }
  return { parent: path.relative(root.real, directory) === "" ? null : path.dirname(directory), breadcrumbs };
}

async function readDirectories(directory: string, roots: Root[], prefix: string): Promise<{ entries: RepositoryDirectory[]; truncated: boolean } | null> {
  const entries: RepositoryDirectory[] = [];
  let truncated = false;
  let handle: Dir | undefined;
  let scanned = 0;
  const deadline = Date.now() + SCAN_TIME_MS;
  try {
    handle = await fs.opendir(directory);
    for await (const entry of handle) {
      if (++scanned > MAX_SCANNED || Date.now() > deadline) { truncated = true; break; }
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (!entry.name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) continue;
      const candidate = path.join(directory, entry.name);
      if (!await safeRealDirectory(candidate, roots)) continue;
      if (entries.length === MAX_ENTRIES) { truncated = true; break; }
      entries.push({ name: entry.name, path: candidate });
    }
  } catch { return null; }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return { entries, truncated };
}

export async function discoverRepositoryDirectories(request: RepositoryPathRequest): Promise<RepositoryPathSuggestions | null> {
  const roots = await configuredRoots();
  const platform = process.platform === "win32" ? "win32" : "posix";
  const responseBase = { platform, separator: platform === "win32" ? "\\" : "/", roots: roots.map(rootDirectory) } as const;
  if (!request.path?.trim()) return { ...responseBase, directory: null, parent: null, breadcrumbs: [], entries: [], truncated: false };
  const mode = request.mode ?? "complete";
  if (mode !== "browse" && mode !== "complete") return null;
  const target = normalizeRepositoryPath(request.path);
  if (!target || !inScope(target, roots)) return null;

  let directory = target;
  let prefix = "";
  const text = request.path.trim().replace(/^(["'])(.*)\1$/su, "$2");
  const trailingSeparator = text.endsWith("/") || (platform === "win32" && text.endsWith("\\"));
  const isRoot = roots.some((root) => path.relative(root.path, target) === "" || path.relative(root.real, target) === "");
  if (mode === "complete" && !trailingSeparator && !isRoot) {
    // Complete the final segment, even when it already names an existing
    // folder. Only a trailing separator asks to complete its children.
    directory = path.dirname(target);
    prefix = path.basename(target);
  }
  const realDirectory = await safeRealDirectory(directory, roots);
  if (!realDirectory) return null;
  const { parent, breadcrumbs } = trail(realDirectory, roots);
  const listing = await readDirectories(realDirectory, roots, prefix);
  if (!listing) return null;
  return { ...responseBase, directory: realDirectory, parent, breadcrumbs, ...listing };
}
