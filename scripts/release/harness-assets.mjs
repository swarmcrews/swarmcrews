import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Standalone JS loaded by external harnesses cannot rely on the TS compiler. */
export function copyHarnessAssets(repo, app) {
  for (const file of ["server/harness/pi/swarm-tools-extension.mjs", "server/harness/tool-result-text.mjs"]) {
    const destination = join(app, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repo, file), destination);
  }
}
