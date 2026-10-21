import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { libraryFixture, runtimeFixture, workspaceFixture, leaderItemFixture, changeItem, quietRuntime } from "./test-fixture.ts";
import { recordContextChanged, withLibrary } from "./store.ts";
import { summarizeLibrary } from "./summary.ts";
import { acknowledgeAll, unreadOverview } from "./read-state.ts";

let fixture: ReturnType<typeof libraryFixture>; let runtime: ReturnType<typeof runtimeFixture>;
let first: ReturnType<typeof workspaceFixture>; let second: ReturnType<typeof workspaceFixture>;
beforeEach(() => { fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home);
  runtime = runtimeFixture(fixture.root); first = workspaceFixture(fixture.root, "First"); second = workspaceFixture(fixture.root, "Second"); });
afterEach(() => { runtime.close(); vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
const overview = () => withLibrary(db => unreadOverview(db, runtime));
const unread = (id: string) => withLibrary(db => summarizeLibrary(db, runtime, quietRuntime, [id])[0]!.unread);

describe("Library-wide read state", () => {
  it("counts unread leader conversations and context events across every registered project", () => {
    expect(overview()).toMatchObject({ total: 0, projects: 0 });
    leaderItemFixture(runtime, first, "a", 100); leaderItemFixture(runtime, second, "b", 100);
    changeItem(runtime, "b", { runtime: "working" }, 200);
    recordContextChanged(first.id, "new context");
    const result = overview();
    expect(result).toMatchObject({ total: 3, projects: 2 });
    expect(result.asOf).toBeLessThanOrEqual(Date.now());
  });

  it("clears every project's unread events without touching review, decision or integration state", () => {
    leaderItemFixture(runtime, first, "a", 100); changeItem(runtime, "a", { runtime: "inactive", outcome: "completed" }, 150);
    leaderItemFixture(runtime, second, "b", 100); recordContextChanged(second.id, "ctx");
    const before = runtime.prepare("SELECT id,runtime_state,outcome,resolution,integration_state,lifecycle_revision FROM work_items ORDER BY id").all();
    const { asOf, total } = overview();
    expect(withLibrary(db => acknowledgeAll(db, runtime, { asOf }))).toEqual({ ok: true, cleared: total });
    expect(overview()).toMatchObject({ total: 0, projects: 0 });
    expect(unread(first.id)).toBe(0); expect(unread(second.id)).toBe(0);
    expect(runtime.prepare("SELECT id,runtime_state,outcome,resolution,integration_state,lifecycle_revision FROM work_items ORDER BY id").all()).toEqual(before);
    expect(withLibrary(db => summarizeLibrary(db, runtime, quietRuntime, [first.id])[0]!)).toMatchObject({ state: "attention", attention: { review: 1 } });
  });

  it("leaves events that arrived after the counted instant unread", () => {
    leaderItemFixture(runtime, first, "a", 100);
    const { asOf, total } = overview(); expect(total).toBe(1);
    changeItem(runtime, "a", { runtime: "working" }, asOf + 5000);
    expect(withLibrary(db => acknowledgeAll(db, runtime, { asOf }))).toEqual({ ok: true, cleared: 1 });
    expect(unread(first.id)).toBe(1);
  });

  it("clamps a future watermark to the present rather than clearing later arrivals", () => {
    leaderItemFixture(runtime, first, "a", Date.now() + 60_000);
    expect(withLibrary(db => acknowledgeAll(db, runtime, { asOf: Date.now() + 3_600_000 }))).toEqual({ ok: true, cleared: 0 });
    expect(unread(first.id)).toBe(1);
  });

  it("scopes a project clear to the named project and re-unreads revised events", () => {
    leaderItemFixture(runtime, first, "a", 100); leaderItemFixture(runtime, second, "b", 100);
    withLibrary(db => acknowledgeAll(db, runtime, { asOf: Date.now(), projectIds: [first.id] }));
    expect(unread(first.id)).toBe(0); expect(unread(second.id)).toBe(1);
    changeItem(runtime, "a", { runtime: "working" });
    expect(unread(first.id)).toBe(1);
  });

  it("rejects unregistered projects and unavailable work history without partial writes", () => {
    leaderItemFixture(runtime, first, "a", 100);
    expect(() => withLibrary(db => acknowledgeAll(db, runtime, { asOf: Date.now(), projectIds: ["00000000-0000-4000-8000-000000000000"] }))).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => withLibrary(db => acknowledgeAll(db, null, { asOf: Date.now() }))).toThrow(expect.objectContaining({ status: 503 }));
    expect(() => withLibrary(db => unreadOverview(db, null))).toThrow(expect.objectContaining({ status: 503 }));
    expect(unread(first.id)).toBe(1);
  });
});
