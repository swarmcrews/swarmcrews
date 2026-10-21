import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionHost } from "./session-host.ts";
import { projectActivitySummary } from "./project-activity.ts";
import { libraryRuntimeEvidence } from "./project-library/runtime.ts";
import { withoutArchivedWork } from "./session-list-visibility.ts";

const mocks = vi.hoisted(() => ({ db: null as Database.Database | null, lookup: vi.fn() }));
vi.mock("./session-persist.ts", () => ({ persistenceDb: () => mocks.db }));
vi.mock("./workspace-registry.ts", () => ({ createWorkspaceSourceLookup: () => mocks.lookup }));
afterEach(() => { mocks.db?.close(); mocks.db = null; vi.clearAllMocks(); });

function host(key: string, status: string, role = "leader", cwd = "/alpha", workItemId: string | null = null): [string, SessionHost] {
  return [key, {
    status, role, cwd, workItemId, worktree: null, runKey: key, parentRunKey: null,
    get usageTotals() { throw new Error("badge read usage"); },
    taskState: null,
    get eventBuffer() { throw new Error("badge read history"); },
    get renderState() { throw new Error("badge read dashboard"); },
    get harnessName() { throw new Error("badge read harness"); },
  } as unknown as SessionHost];
}

describe("project activity summaries", () => {
  it("separates waiting hosts from execution without changing legacy activity counts", () => {
    mocks.lookup.mockReturnValue({ id: "alpha" });
    const waiting = projectActivitySummary([
      host("waiting-leader", "waiting"), host("waiting-child", "waiting", "minion"), host("waiting-other", "waiting", "default"),
    ], ["alpha"])[0]!;
    expect(waiting).toEqual({ projectId: "alpha", activeLeaders: 1, activeCrew: 0 });
    expect(libraryRuntimeEvidence(waiting)).toEqual({ known: true, activeOther: 2, runningLeaders: 0, runningOther: 0 });
    const mixed = projectActivitySummary([host("waiting", "waiting"), host("running", "running"), host("other", "starting", "default")], ["alpha"])[0]!;
    expect(mixed.activeLeaders).toBe(2);
    expect(libraryRuntimeEvidence(mixed)).toMatchObject({ runningLeaders: 1, runningOther: 1 });
  });

  it.each(["creating", "starting", "running"])("retains execution authority for an orphaned %s minion without inventing badge ownership", status => {
    mocks.lookup.mockReturnValue({ id: "alpha" });
    const orphan = host("orphan", status, "minion");
    orphan[1].parentRunKey = "missing-parent";
    const result = projectActivitySummary([orphan], ["alpha"])[0]!;
    expect(result).toEqual({ projectId: "alpha", activeLeaders: 0, activeCrew: 0 });
    expect(libraryRuntimeEvidence(result)).toEqual({ known: true, activeOther: 1, runningLeaders: 0, runningOther: 1 });
  });

  it("does not double count execution authority for children already represented by parent identity or roster", () => {
    mocks.lookup.mockReturnValue({ id: "alpha" });
    const leader = host("leader-run", "idle");
    leader[0] = "leader-session";
    const child = host("child", "running", "minion");
    child[1].parentRunKey = "leader-run";
    const rosterChild = host("roster-child", "running", "minion");
    rosterChild[1].parentRunKey = "missing-parent";
    leader[1].taskState = { tasks: new Map([["task", { status: "running", minionSessionKey: "roster-child" }]]) } as SessionHost["taskState"];
    const result = projectActivitySummary([leader, child, rosterChild], ["alpha"])[0]!;
    expect(result.activeCrew).toBe(2);
    expect(libraryRuntimeEvidence(result)).toMatchObject({ activeOther: 0, runningOther: 0 });
  });

  it.each(["idle", "stopped", "error", "completed", "disconnected"])("does not treat a terminal/inactive orphan (%s) as executing", status => {
    mocks.lookup.mockReturnValue({ id: "alpha" });
    const orphan = host("orphan", status, "minion");
    orphan[1].parentRunKey = "missing-parent";
    expect(libraryRuntimeEvidence(projectActivitySummary([orphan], ["alpha"])[0]))
      .toMatchObject({ known: true, activeOther: 0, runningOther: 0 });
  });

  it("counts active leaders and executing crew in requested workspaces, without reading detail", () => {
    mocks.lookup.mockImplementation((path: string) => ({ id: path.slice(1) }));
    const isolated = host("isolated", "running", "leader", "/central/worktrees/run");
    isolated[1].worktree = { projectPath: "/alpha" } as SessionHost["worktree"];
    expect(projectActivitySummary([
      host("running", "running"), host("creating", "creating"), host("waiting", "waiting"), isolated,
      host("child", "running", "minion"), host("other", "running", "leader", "/beta"),
      host("stopped", "stopped"), host("complete", "completed"),
    ], ["alpha", "empty", "alpha"])).toEqual([
      { projectId: "alpha", activeLeaders: 4, activeCrew: 1 }, { projectId: "empty", activeLeaders: 0, activeCrew: 0 },
    ]);
  });

  it("skips historical hosts before workspace lookup and does no work for empty scope", () => {
    expect(projectActivitySummary([host("old", "stopped")], ["alpha"]))
      .toEqual([{ projectId: "alpha", activeLeaders: 0, activeCrew: 0 }]);
    expect(projectActivitySummary([host("running", "running")], [])).toEqual([]);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("filters archives using only membership and sees restores on the next request", () => {
    const statements: string[] = [];
    mocks.db = new Database(":memory:", { verbose: (sql) => statements.push(String(sql)) });
    mocks.db.exec("CREATE TABLE work_items (id TEXT PRIMARY KEY, resolution TEXT, report TEXT)");
    const insert = mocks.db.prepare("INSERT INTO work_items VALUES (?, ?, ?)");
    insert.run("archived", "archived", "x".repeat(100000));
    insert.run("open", "open", "x".repeat(100000));
    statements.length = 0;
    mocks.lookup.mockReturnValue({ id: "alpha" });
    const entries = [host("old", "running", "leader", "/alpha", "archived"),
      host("new", "waiting", "leader", "/alpha", "open"), host("legacy", "running")];
    expect(withoutArchivedWork(entries, mocks.db).map(([key]) => key)).toEqual(["new", "legacy"]);
    expect(projectActivitySummary(entries, ["alpha"])).toEqual([{ projectId: "alpha", activeLeaders: 2, activeCrew: 0 }]);
    expect(statements.every((sql) => sql.startsWith("SELECT id FROM work_items"))).toBe(true);
    mocks.db.prepare("UPDATE work_items SET resolution = 'open' WHERE id = 'archived'").run();
    expect(projectActivitySummary(entries, ["alpha"])).toEqual([{ projectId: "alpha", activeLeaders: 3, activeCrew: 0 }]);
  });

  it("projects idle leaders' rosters and graph children without reading session details", () => {
    mocks.lookup.mockImplementation((path: string) => ({ id: path.slice(1) }));
    const leader = host("leader", "idle");
    leader[1].taskState = { tasks: new Map([
      ["live", { status: "running", minionSessionKey: "live" }],
      ["launch", { status: "starting", minionSessionKey: null }],
      ["done", { status: "running", minionSessionKey: "done" }],
      ["planned", { status: "planned", minionSessionKey: null }],
      ["blocked", { status: "blocked", minionSessionKey: null }],
    ]) } as SessionHost["taskState"];
    const child = host("graph", "running", "minion", "/central");
    child[1].parentRunKey = "leader";
    expect(projectActivitySummary([
      leader, child, host("live", "running", "minion"), host("done", "completed", "minion"),
      host("waiting", "waiting", "minion"), host("default", "running", "default"),
      host("starting", "starting"),
    ], ["alpha", "central"])).toEqual([
      { projectId: "alpha", activeLeaders: 1, activeCrew: 3 },
      { projectId: "central", activeLeaders: 0, activeCrew: 0 },
    ]);
  });

  it("excludes archived leaders and their children from both counts", () => {
    mocks.db = new Database(":memory:");
    mocks.db.exec("CREATE TABLE work_items (id TEXT PRIMARY KEY, resolution TEXT)");
    mocks.db.exec("INSERT INTO work_items VALUES ('archived', 'archived')");
    mocks.lookup.mockReturnValue({ id: "alpha" });
    const child = host("child", "running", "minion", "/alpha", "archived");
    child[1].parentRunKey = "leader";
    expect(projectActivitySummary([
      host("leader", "running", "leader", "/alpha", "archived"), child,
    ], ["alpha"])).toEqual([{ projectId: "alpha", activeLeaders: 0, activeCrew: 0 }]);
  });

  it("bounds membership queries and preserves hosts with unknown work-item IDs", () => {
    mocks.db = new Database(":memory:");
    mocks.db.exec("CREATE TABLE work_items (id TEXT PRIMARY KEY, resolution TEXT)");
    mocks.db.exec("INSERT INTO work_items VALUES ('w100', 'archived')");
    const entries = Array.from({ length: 205 }, (_, i) => host(`s${i}`, "stopped", "leader", "/alpha", `w${i}`));
    const result = withoutArchivedWork(entries, mocks.db);
    expect(result).toHaveLength(204);
    expect(result.some(([key]) => key === "s100")).toBe(false);
  });
});

it("keeps server-only fresh authority evidence for default/waiting and even hidden archived live hosts", () => {
  mocks.db = new Database(":memory:");
  mocks.db.exec("CREATE TABLE work_items (id TEXT PRIMARY KEY, resolution TEXT)");
  mocks.db.exec("INSERT INTO work_items VALUES ('archived','archived')");
  mocks.lookup.mockReturnValue({ id: "alpha" });
  const result = projectActivitySummary([
    host("default", "running", "default"), host("waiting-child", "waiting", "minion"),
    host("hidden-active", "running", "leader", "/alpha", "archived"),
  ], ["alpha"])[0]!;
  expect(result).toEqual({ projectId: "alpha", activeLeaders: 0, activeCrew: 0 });
  expect(libraryRuntimeEvidence(result)).toEqual({ known: true, activeOther: 3, runningLeaders: 0, runningOther: 2 });
  expect(JSON.stringify(result)).not.toContain("activeOther");
  expect(libraryRuntimeEvidence({ ...result })).toBeUndefined();
});
it("does not turn unknown host statuses or unresolved roster blockers into archive-safe zero counts", () => {
  mocks.lookup.mockReturnValue({ id: "alpha" });
  expect(libraryRuntimeEvidence(projectActivitySummary([host("unknown", "mystery")], ["alpha"])[0])).toMatchObject({ known: false });
  const blocked = host("leader", "idle");
  blocked[1].taskState = { tasks: new Map([["blocked", { status: "blocked", minionSessionKey: null }]]) } as SessionHost["taskState"];
  expect(libraryRuntimeEvidence(projectActivitySummary([blocked], ["alpha"])[0])).toMatchObject({ known: true, archiveBlocked: true });
});

it("keeps accurate live counts when the same leader has planned or blocked work", () => {
  mocks.lookup.mockReturnValue({ id: "alpha" });
  const leader = host("leader", "running");
  leader[1].taskState = { tasks: new Map([["later", { status: "planned", minionSessionKey: null }]]) } as SessionHost["taskState"];
  const result = projectActivitySummary([leader], ["alpha"])[0]!;
  expect(result.activeLeaders).toBe(1);
  expect(libraryRuntimeEvidence(result)).toMatchObject({ known: true, runningLeaders: 1, archiveBlocked: true });
});
