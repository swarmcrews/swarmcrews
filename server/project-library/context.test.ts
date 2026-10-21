import fs from "node:fs";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { libraryFixture, workspaceFixture } from "./test-fixture.ts";
import { writeTrackedContext } from "./context.ts";
import { withLibrary } from "./store.ts";
let fixture: ReturnType<typeof libraryFixture>;
beforeEach(() => { fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
it("persists generic context events on changed saves, not unchanged writes/reads", () => {
  const workspace = workspaceFixture(fixture.root); const file = path.join(workspace.sourceRoot, "AGENTS.md");
  writeTrackedContext(workspace.sourceRoot, file, "Private context");
  writeTrackedContext(workspace.sourceRoot, file, "Private context");
  expect(fs.readFileSync(file, "utf8")).toBe("Private context");
  const rows = withLibrary(db => db.prepare("SELECT * FROM library_context_events").all());
  expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain("Private context");
});
it("opens durable event storage before source writes; a storage failure leaves source and edits intact for retry", () => {
  const workspace = workspaceFixture(fixture.root); const file = path.join(workspace.sourceRoot, "AGENTS.md");
  fs.writeFileSync(file, "Prior context");
  const sentinel = path.join(fixture.root, "sentinel"); fs.writeFileSync(sentinel, "do not overwrite");
  fs.symlinkSync(sentinel, path.join(fixture.home, "project-library.db"));
  expect(() => writeTrackedContext(workspace.sourceRoot, file, "New context")).toThrow("symlink");
  expect(fs.readFileSync(file, "utf8")).toBe("Prior context");
  fs.unlinkSync(path.join(fixture.home, "project-library.db"));
  writeTrackedContext(workspace.sourceRoot, file, "New context");
  expect(withLibrary(db => db.prepare("SELECT COUNT(*) AS n FROM library_context_events").get())).toEqual({ n: 1 });
});
it("a filesystem save failure creates no false meaningful event", () => {
  const workspace = workspaceFixture(fixture.root); const file = path.join(workspace.sourceRoot, "AGENTS.md");
  const write = vi.spyOn(fs, "writeFileSync");
  write.mockImplementationOnce(() => { throw new Error("Filesystem denied"); });
  // Register Library metadata first; only the context file write is injected.
  withLibrary(db => db.prepare("SELECT 1").get());
  expect(() => writeTrackedContext(workspace.sourceRoot, file, "New context")).toThrow("Filesystem denied");
  write.mockRestore();
  expect(fs.existsSync(file)).toBe(false);
  expect(withLibrary(db => db.prepare("SELECT COUNT(*) AS n FROM library_context_events").get())).toEqual({ n: 0 });
});
