import { readFileSync, readdirSync, existsSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { isProviderPackage } from "./config.mjs";

const ALLOWED = new Set(["MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Apache-2.0", "CC0-1.0", "OFL-1.1", "Unlicense", "BlueOak-1.0.0", "WTFPL"]);
export function inspectLicense(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (isProviderPackage(pkg.name)) throw new Error(`Provider installation must not be bundled: ${pkg.name}`);
  const license = pkg.license;
  if (typeof license !== "string" || !license.replace(/[()]/g, "").split(/\s+(?:OR|AND)\s+/).every(term => ALLOWED.has(term))) {
    throw new Error(`Unreviewed redistribution license: ${pkg.name}@${pkg.version}: ${license}`);
  }
  const files = readdirSync(root).filter(name => /^(?:licen[sc]e|copying|notice)(?:[.-]|$)/i.test(name) && statSync(join(root, name)).isFile()).sort();
  const notices = files.map(name => ({ name, text: readFileSync(join(root, name), "utf8") }));
  // saxes' npm tarball omits LICENSE; retain the complete upstream text from
  // v6.0.0 commit 211fa0ebec9b628affc09219199639887174bfc3 (lddubeau/saxes).
  if (pkg.name === "saxes" && pkg.version === "6.0.0" && !notices.length) {
    const text = readFileSync(new URL("./notices/saxes-6.0.0-LICENSE.txt", import.meta.url), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== "0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e") throw new Error("Supplemental license drift");
    notices.push({ name: "upstream-LICENSE", text });
  }
  if (!notices.length) throw new Error(`Missing license text: ${pkg.name}@${pkg.version}`);
  return { name: pkg.name, version: pkg.version, license, notices };
}

export function installedPackage(name, from) {
  const resolver = createRequire(join(from, "package.json"));
  for (const directory of resolver.resolve.paths(`${name}/package.json`) ?? []) {
    const root = join(directory, name);
    if (existsSync(join(root, "package.json"))) return realpathSync(root);
  }
  return null;
}

/** Follow actual installed dependencies, not package.json metadata alone. */
export function collectLicenses(roots) {
  const seen = new Set();
  const records = [];
  function visit(root) {
    root = realpathSync(root);
    if (seen.has(root)) return;
    seen.add(root);
    records.push(inspectLicense(root));
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
    for (const name of Object.keys(deps).sort()) {
      const child = installedPackage(name, root);
      if (child) visit(child);
      else if (Object.hasOwn(pkg.dependencies ?? {}, name) && !Object.hasOwn(pkg.optionalDependencies ?? {}, name)) throw new Error(`Missing dependency ${name} of ${pkg.name}`);
    }
  }
  roots.forEach(visit);
  const unique = new Map(records.map(record => [`${record.name}@${record.version}`, record]));
  return [...unique.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

export function writeNotices(records, destination) {
  const text = records.map(record => `## ${record.name}@${record.version} (${record.license})\n\n${record.notices.map(notice => `${notice.name}\n${notice.text}`).join("\n\n")}`).join("\n\n---\n\n");
  writeFileSync(join(destination, "THIRD-PARTY-NOTICES.txt"), text + "\n");
  writeFileSync(join(destination, "dependency-inventory.json"), JSON.stringify(records.map(({ notices, ...record }) => ({
    ...record, notices: notices.map(({ name, text }) => ({ name, sha256: createHash("sha256").update(text).digest("hex") })),
  })), null, 2) + "\n");
}
