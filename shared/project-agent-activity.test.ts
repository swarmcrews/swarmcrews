import { describe, expect, it } from "vitest";
import { projectAgentActivity, type ProjectAgentSession } from "./project-agent-activity.ts";

const session = (sessionKey: string, overrides: Partial<ProjectAgentSession & { projectId: string }> = {}) => ({
  sessionKey, projectId: "alpha", role: "leader", status: "running", ...overrides,
});
const belongs = (entry: { projectId: string }) => entry.projectId === "alpha";

describe("shared project agent activity", () => {
  it("counts working, starting and waiting leaders but not other roles or terminal statuses", () => {
    const sessions = ["running", "creating", "starting", "waiting", "idle", "completed", "error", "stopped", "cancelled"]
      .map((status) => session(status, { status }));
    sessions.push(session("default", { role: "default" }), session("other", { projectId: "beta" }));
    expect(projectAgentActivity(sessions, belongs).active.map((entry) => entry.sessionKey))
      .toEqual(["running", "creating", "starting", "waiting"]);
  });

  it("deduplicates roster and live crew, including children of idle leaders", () => {
    const sessions = [
      session("leader", { status: "idle", runKey: "run", activeMinions: [
        { taskId: "live", status: "running", sessionKey: "live" },
        { taskId: "starting", status: "starting", sessionKey: null },
        { taskId: "done", status: "running", sessionKey: "done" },
        { taskId: "planned", status: "planned", sessionKey: null },
        { taskId: "blocked", status: "blocked", sessionKey: null },
      ] }),
      session("live", { role: "minion" }),
      session("done", { role: "minion", status: "completed" }),
      session("graph", { role: "minion", parentRunKey: "run", projectId: "central" }),
      session("creating", { role: "minion", status: "creating" }),
      session("starting", { role: "minion", status: "starting" }),
      session("waiting", { role: "minion", status: "waiting" }),
      session("idle", { role: "minion", status: "idle" }),
      session("other-parent", { role: "minion", parentRunKey: "other" }),
      session("other-project", { role: "minion", projectId: "beta" }),
    ];
    expect(projectAgentActivity(sessions, belongs)).toEqual({ active: [], activeCrew: 5 });
  });

  it("counts crew without leaders but excludes terminal or unrelated crew", () => {
    expect(projectAgentActivity([
      session("live", { role: "minion" }),
      session("finished", { role: "minion", status: "completed" }),
      session("unrelated", { role: "minion", projectId: "beta" }),
    ], belongs)).toEqual({ active: [], activeCrew: 1 });
  });
});
