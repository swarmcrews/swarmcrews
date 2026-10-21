import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openSourceDirectory, requireProtectedOwner } from "./directory.ts";
it("requires root ownership and non-writable ancestry, not merely file ownership", () => {
  expect(() => requireProtectedOwner({ uid: 0, mode: 0o40755 })).not.toThrow();
  expect(() => requireProtectedOwner({ uid: 1000, mode: 0o40700 })).toThrow();
  expect(() => requireProtectedOwner({ uid: 0, mode: 0o41777 })).toThrow();
  expect(() => requireProtectedOwner({ uid: 0, mode: 0o100664 })).toThrow();
});
it.skipIf(process.platform !== "linux")("rejects intermediate symlinks and unprotected directory ancestry", () => {
  const base = mkdtempSync(join(tmpdir(), "browser-directory-"));
  try {
    mkdirSync(join(base, "target", "workspace"), { recursive: true });
    symlinkSync(join(base, "target"), join(base, "alias"));
    expect(() => openSourceDirectory(join(base, "alias", "workspace"))).toThrow();
    expect(() => openSourceDirectory(base, true)).toThrow();
    const directory = openSourceDirectory(join(base, "target", "workspace")); directory.close(); directory.close();
  } finally { rmSync(base, { recursive: true, force: true }); }
});
