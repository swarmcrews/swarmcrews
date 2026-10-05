import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { NODE_VERSION, TARGETS, assertReleaseVersion } from "./config.mjs";

export function assertManifest(manifest, { version, commit, target }) {
  assert.equal(manifest.version, version, "Artifact version mismatch");
  assert.equal(manifest.sourceCommit, commit, "Artifact source mismatch");
  assert.equal(manifest.target, target, "Artifact target mismatch");
  assert.equal(manifest.nodeVersion, NODE_VERSION, "Artifact Node mismatch");
  assert.equal(manifest.dirty, false, "Artifact built from dirty source");
}
export function expectedAssets(version) {
  return Object.keys(TARGETS).flatMap(target => {
    const file = `swarmcrews-${version}-${target}.${target.startsWith("win32") ? "zip" : "tar.gz"}`;
    return [file, `${file}.sha256`];
  }).sort();
}
export function checkAssets(directory, version, commit) {
  assert.deepEqual(readdirSync(directory).sort(), expectedAssets(version), "Incomplete or unexpected release asset set");
  for (const target of Object.keys(TARGETS)) {
    const name = `swarmcrews-${version}-${target}`;
    const archive = join(directory, `${name}.${target.startsWith("win32") ? "zip" : "tar.gz"}`);
    const checksum = readFileSync(`${archive}.sha256`, "utf8");
    const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
    assert.equal(checksum, `${digest}  ${basename(archive)}\n`, "Checksum mismatch");
    const manifest = JSON.parse(execFileSync(target.startsWith("win32") ? "unzip" : "tar", target.startsWith("win32")
      ? ["-p", archive, `${name}/release.json`] : ["-xOf", archive, `${name}/release.json`], { encoding: "utf8", timeout: 30_000 }));
    assertManifest(manifest, { version, commit, target });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const runtimePkg = JSON.parse(readFileSync("scripts/release/runtime/package.json", "utf8"));
  assert.equal(runtimePkg.version, pkg.version);
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const commit = git("rev-parse", "HEAD");
  assert.equal(commit, process.env.GITHUB_SHA ?? commit);
  assert.equal(git("status", "--porcelain"), "", "Release gates require a clean source tree");
  if (process.argv[2] === "assets") checkAssets(resolve(process.argv[3]), pkg.version, commit);
  else if (process.argv[2] === "publish") {
    assert.equal(process.env.GITHUB_REPOSITORY, "swarmcrews/swarmcrews");
    assert.equal(process.env.GITHUB_REF_TYPE, "tag");
    assertReleaseVersion(pkg.version, process.env.GITHUB_REF_NAME);
    assert.equal(git("rev-list", "-n", "1", process.env.GITHUB_REF_NAME), commit);
    git("merge-base", "--is-ancestor", commit, "origin/main");
    // A tag must not bypass the normal CI/Installer workflows for its commit.
    for (const workflow of ["ci.yml", "installer.yml"]) {
      const runs = JSON.parse(execFileSync("gh", ["run", "list", "--repo", "swarmcrews/swarmcrews", "--commit", commit, "--workflow", workflow, "--event", "push", "--limit", "20", "--json", "headSha,status,conclusion"], { encoding: "utf8", timeout: 30_000 }));
      assert.ok(runs.some(run => run.headSha === commit && run.status === "completed" && run.conclusion === "success"), `${workflow} has no successful push run for this exact commit`);
    }
  } else {
    assertReleaseVersion(pkg.version, `v${pkg.version}`);
  }
  console.log("Release gates passed");
}
