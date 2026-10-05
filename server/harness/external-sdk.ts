import { resolve } from "import-meta-resolve";
import { isAbsolute, join, relative, sep } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Only explicit, trusted installation prefixes are searched. Never resolve a
 * provider from a project cwd, invoke a package manager, or download on launch.
 * Source checkouts retain their normal dependency imports; portable packages
 * must not accidentally pick up dependencies from a parent checkout. */
export function resolveExternalSdk(
  packageName: string,
  envName: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const root = env[envName]?.trim();
  if (!root && env["SWARMCREWS_PACKAGED"] !== "1") return null;
  const help = `Install ${packageName} separately and set ${envName} to its absolute installation prefix (containing node_modules).`;
  if (!root) throw new Error(help);
  if (!isAbsolute(root)) throw new Error(`${envName} must be absolute. ${help}`);
  try {
    const modules = realpathSync(join(root, "node_modules"));
    const entry = realpathSync(fileURLToPath(resolve(packageName, pathToFileURL(join(root, "package.json")).href)));
    const within = relative(modules, entry);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error("SDK resolved outside installation");
    return pathToFileURL(entry).href;
  } catch (cause) {
    throw new Error(help, { cause });
  }
}
