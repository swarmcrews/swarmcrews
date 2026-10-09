#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, chmodSync, existsSync, lstatSync } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { NODE_VERSION, TARGETS, releaseTarget, RUNTIME_PACKAGES, isProviderPackage } from "./config.mjs";
import { collectLicenses, installedPackage, writeNotices } from "./licenses.mjs";
import { createRequire } from "node:module";
import { nativeTar } from "./command.mjs";
import { copyHarnessAssets } from "./harness-assets.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(process.argv[2] ?? join(repo, ".scratch/release-alpha/artifacts"));
mkdirSync(output, { recursive: true });
if (readdirSync(output).length) throw new Error("Output directory must be empty (never mix release assets)");
const target = releaseTarget();
const config = TARGETS[target];
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const runtimePkg = JSON.parse(readFileSync(join(repo, "scripts/release/runtime/package.json"), "utf8"));
for (const name of RUNTIME_PACKAGES) {
  const sourceVersion = (pkg.dependencies[name] ?? pkg.devDependencies[name]).replace(/^[~^]/, "");
  if (runtimePkg.dependencies[name] !== sourceVersion) throw new Error(`Update portable runtime lock for ${name}`);
}
const stage = mkdtempSync(join(output, ".stage-"));
const name = `swarmcrews-${pkg.version}-${target}`;
const app = join(stage, name);
mkdirSync(app);
function run(command, args, cwd = repo) {
  const env = { ...process.env }; delete env.NODE_ENV;
  execFileSync(command, args, { cwd, stdio: "inherit", env, timeout: 600_000 });
}
// Follow installed CLI entries, not Windows package-manager self-update shims.
const require = createRequire(join(repo, "package.json"));
const compilerManifest = require.resolve("typescript/package.json");
const compiler = join(dirname(compilerManifest), JSON.parse(readFileSync(compilerManifest, "utf8")).bin.tsc);
run(process.execPath, ["scripts/production-build.mjs"]);
run(process.execPath, [compiler, "-p", "scripts/release/tsconfig.json", "--outDir", app]);
cpSync(join(repo, "dist"), join(app, "web"), { recursive: true });
copyHarnessAssets(repo, app);
cpSync(join(repo, "shared/owned-processes.mjs"), join(app, "shared/owned-processes.mjs"));
for (const file of ["package.json", "package-lock.json"]) cpSync(join(repo, "scripts/release/runtime", file), join(app, file));
const npmArgs = ["ci", "--ignore-scripts", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund"];
if (process.platform === "win32") {
  run(process.execPath, [join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), ...npmArgs], app);
} else run("npm", npmArgs, app);
// No package manager metadata or executable wrappers are needed at runtime.
rmSync(join(app, "package-lock.json"));
rmSync(join(app, "node_modules/.package-lock.json"), { force: true });
function inspectTree(directory) {
  for (const entry of readdirSync(directory)) {
    const file = join(directory, entry);
    if (entry === ".bin") { rmSync(file, { recursive: true, force: true }); continue; }
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`Symlink in portable archive: ${relative(app, file)}`);
    if (stat.isDirectory()) inspectTree(file);
    else if (entry === "package.json") {
      const dependency = JSON.parse(readFileSync(file, "utf8"));
      if (isProviderPackage(dependency.name ?? "")) throw new Error(`Provider package in archive: ${dependency.name}`);
    }
  }
}
inspectTree(app);
const frontendNames = Object.keys(pkg.dependencies).filter(n => !RUNTIME_PACKAGES.includes(n) && !isProviderPackage(n));
const licenses = collectLicenses([
  ...RUNTIME_PACKAGES.map(n => installedPackage(n, app)),
  ...frontendNames.map(n => installedPackage(n, repo)),
]);
writeNotices(licenses, app);
cpSync(join(repo, "LICENSE"), join(app, "LICENSE"));
if (existsSync(join(repo, "NOTICE"))) cpSync(join(repo, "NOTICE"), join(app, "NOTICE"));

const nodePlatform = process.platform === "win32" ? "win" : process.platform;
const nodeName = `node-v${NODE_VERSION}-${nodePlatform}-${process.arch}`;
const nodeArchive = `${nodeName}.${config.archive}`;
const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${nodeArchive}`, { signal: AbortSignal.timeout(120_000) });
if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== config.sha256) throw new Error("Node archive checksum mismatch");
writeFileSync(join(stage, nodeArchive), bytes);
run(nativeTar(), ["-xf", join(stage, nodeArchive), "-C", stage]);
mkdirSync(join(app, "runtime"));
const nodeExe = process.platform === "win32" ? "node.exe" : "node";
cpSync(join(stage, nodeName, process.platform === "win32" ? nodeExe : `bin/${nodeExe}`), join(app, "runtime", nodeExe));
cpSync(join(stage, nodeName, "LICENSE"), join(app, "runtime/LICENSE"));
chmodSync(join(app, "runtime", nodeExe), 0o755);
cpSync(join(repo, "scripts/release/launcher.mjs"), join(app, "swarmcrews.mjs"));
writeFileSync(join(app, "swarmcrews"), '#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "${0%/*}" && pwd)\nexec "$ROOT/runtime/node" "$ROOT/swarmcrews.mjs" "$@"\n', { mode: 0o755 });
writeFileSync(join(app, "swarmcrews.cmd"), '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0swarmcrews.mjs" %*\r\n');
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: repo, encoding: "utf8" }).trim());
writeFileSync(join(app, "release.json"), JSON.stringify({ version: pkg.version, target, nodeVersion: NODE_VERSION, sourceCommit, dirty }, null, 2) + "\n");
cpSync(join(repo, "docs/portable-installation.md"), join(app, "INSTALL.md"));
const extension = process.platform === "win32" ? "zip" : "tar.gz";
const archive = join(output, `${name}.${extension}`);
run(nativeTar(), process.platform === "win32" ? ["-a", "-cf", archive, "-C", stage, name] : ["-czf", archive, "-C", stage, name]);
const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${sha256}  ${name}.${extension}\n`);
rmSync(stage, { recursive: true, force: true });
console.log(`Built ${archive}`);
