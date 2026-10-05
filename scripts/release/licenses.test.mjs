import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectLicense } from "./licenses.mjs";

test("redistribution gate rejects provider packages, unknown licenses and missing notices", () => {
  const root = mkdtempSync(join(tmpdir(), "release-license-"));
  try {
    const manifest = (name, license) => writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "1.0.0", license }));
    manifest("example", "MIT");
    assert.throws(() => inspectLicense(root), /license text/);
    writeFileSync(join(root, "LICENSE"), "Example MIT license text");
    assert.equal(inspectLicense(root).license, "MIT");
    manifest("example", "UNLICENSED"); assert.throws(() => inspectLicense(root), /Unreviewed/);
    manifest("@openai/codex-sdk", "Apache-2.0"); assert.throws(() => inspectLicense(root), /Provider/);
    manifest("example", "SEE LICENSE IN README.md"); assert.throws(() => inspectLicense(root), /Unreviewed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
