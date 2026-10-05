import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { releaseTarget, assertReleaseVersion, isProviderPackage, RUNTIME_PACKAGES } from "./config.mjs";

test("only declared native targets and exact alpha tags are accepted", () => {
  assert.equal(releaseTarget("linux", "x64"), "linux-x64");
  assert.throws(() => releaseTarget("linux", "arm64"), /Unsupported/);
  assertReleaseVersion("0.1.0-alpha.1", "v0.1.0-alpha.1");
  for (const [version, tag] of [["0.1.0", "v0.1.0"], ["0.1.0-alpha.1", "main"], ["0.1.0-alpha.1", "v0.1.0-alpha.2"]]) {
    assert.throws(() => assertReleaseVersion(version, tag));
  }
});
test("release shell scripts and hash-pinned notices retain LF on Windows checkout", () => {
  const attributes = execFileSync("git", ["check-attr", "eol", "--", "install/portable.sh", "scripts/release/notices/saxes-6.0.0-LICENSE.txt"], { encoding: "utf8" });
  for (const line of attributes.trim().split(/\r?\n/)) assert.ok(line.endsWith(": lf"), line);
});
test("runtime dependency manifest is pinned, complete, and excludes providers", () => {
  const runtime = JSON.parse(readFileSync(new URL("./runtime/package.json", import.meta.url)));
  const app = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url)));
  assert.deepEqual(Object.keys(runtime.dependencies).sort(), [...RUNTIME_PACKAGES].sort());
  assert.equal(runtime.version, app.version);
  const lock = JSON.parse(readFileSync(new URL("./runtime/package-lock.json", import.meta.url)));
  assert.equal(lock.version, app.version); assert.equal(lock.packages[""].version, app.version);
  assert.ok(readFileSync(new URL("../../install/portable.sh", import.meta.url), "utf8").includes(`version=${app.version}\n`));
  assert.ok(readFileSync(new URL("../../install/portable.ps1", import.meta.url), "utf8").includes(`$Version = '${app.version}'`));
  for (const [name, version] of Object.entries(runtime.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(version, (app.dependencies[name] ?? app.devDependencies[name]).replace(/^[~^]/, ""));
    assert.equal(isProviderPackage(name), false);
  }
  for (const name of ["@anthropic-ai/claude-agent-sdk", "@openai/codex-sdk", "@github/copilot-sdk", "@github/copilot-linux-x64", "@mariozechner/pi-coding-agent", "opencode-ai"]) {
    assert.equal(isProviderPackage(name), true);
  }
});
