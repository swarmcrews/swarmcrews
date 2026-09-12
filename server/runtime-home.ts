import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Prefer the new home, but keep existing installations on their legacy state. */
export function resolveSwarmcrewsHome(
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string {
  const override = env["SWARMCREWS_HOME"] ?? env["MINIONS_HOME"];
  if (override !== undefined) return path.resolve(override);
  const current = path.join(home, ".swarmcrews");
  const legacy = path.join(home, ".minions");
  return fs.existsSync(current) || !fs.existsSync(legacy) ? current : legacy;
}
