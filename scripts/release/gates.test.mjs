import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertManifest, expectedAssets, checkAssets } from "./gates.mjs";
import { NODE_VERSION } from "./config.mjs";

test("promotion requires exact source, version, target, runtime, and clean build", () => {
  const expected = { version: "0.1.0-alpha.1", commit: "a".repeat(40), target: "linux-x64" };
  const manifest = { version: expected.version, sourceCommit: expected.commit, target: expected.target, nodeVersion: NODE_VERSION, dirty: false };
  assertManifest(manifest, expected);
  for (const [key, value] of Object.entries({ version: "0.1.0", sourceCommit: "b".repeat(40), target: "linux-arm64", nodeVersion: "22.0.0", dirty: true })) {
    assert.throws(() => assertManifest({ ...manifest, [key]: value }, expected));
  }
});
test("incomplete, extra, and corrupted release assets fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "release-gates-"));
  const version = "0.1.0-alpha.1";
  try {
    assert.equal(expectedAssets(version).length, 8);
    assert.throws(() => checkAssets(root, version, "a".repeat(40)), /asset set/);
    for (const name of expectedAssets(version)) writeFileSync(join(root, name), "corrupt");
    assert.throws(() => checkAssets(root, version, "a".repeat(40)), /Checksum/);
    writeFileSync(join(root, "unexpected.txt"), "extra");
    assert.throws(() => checkAssets(root, version, "a".repeat(40)), /asset set/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
