import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionHost } from "./session-host.ts";
import { projectActivitySummary } from "./project-activity.ts";
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
