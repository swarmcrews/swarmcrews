import fs from "node:fs";
import path from "node:path";
import { projectActivitySummary } from "../../server/project-activity.ts";
import { registerWorkspace } from "../../server/workspace-registry.ts";
import { closePersistDb } from "../../server/session-persist.ts";
import type { SessionHost } from "../../server/session-host.ts";
import { projectActivityResponseSchema } from "../../shared/project-activity.ts";
import express, { Router } from "express";
import { afterAll, describe, expect, it, vi } from "vitest";
import { mountProjectActivityRoute } from "../../server/routes/projects/activity.ts";
import { createExpressFetch } from "../harness/in-process-http.ts";

afterAll(() => closePersistDb());

function setup(summary: (ids: string[]) => ReturnType<typeof projectActivitySummary> =
  (ids) => ids.map((projectId) => ({ projectId, activeLeaders: 2, activeCrew: 0 }))) {
  const summarize = vi.fn(summary);
  const router = Router();
  mountProjectActivityRoute(router, summarize);
  const app = express();
  app.use(express.json());
  app.use("/api/projects", router);
  const fetch = createExpressFetch(app);
  const request = (body: unknown) => fetch("http://in-process.local/api/projects/activity-summary", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { summarize, request };
}

describe("project badge HTTP contract", () => {
  it("returns only requested counts and deduplicates IDs", async () => {
    const h = setup();
    const response = await h.request({ projectIds: ["p1", "p1", "p2"] });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual([
      { projectId: "p1", activeLeaders: 2, activeCrew: 0 }, { projectId: "p2", activeLeaders: 2, activeCrew: 0 },
    ]);
    expect(h.summarize).toHaveBeenCalledWith(["p1", "p2"]);
  });

  it("returns both current counters on every poll from the real registry summary", async () => {
    const root = path.join(process.env["MINIONS_HOME"]!, "poll-project");
    fs.mkdirSync(root);
    const project = registerWorkspace(root)!;
    const leader = {
      runKey: "leader", role: "leader", status: "running", cwd: root,
      workItemId: null, worktree: null, parentRunKey: null, taskState: null,
    } as unknown as SessionHost;
    const child = {
      ...leader, runKey: "child", role: "minion", parentRunKey: "leader",
    } as SessionHost;
    const entries = new Map([["leader", leader], ["child", child]]);
    const h = setup((ids) => projectActivitySummary(entries, ids));
    const poll = async () => {
      const response = await h.request({ projectIds: [project.id] });
      expect(response.status).toBe(200);
      return projectActivityResponseSchema.parse(await response.json());
    };
    expect(await poll()).toEqual([{ projectId: project.id, activeLeaders: 1, activeCrew: 1 }]);
    leader.status = "idle";
    expect(await poll()).toEqual([{ projectId: project.id, activeLeaders: 0, activeCrew: 1 }]);
    child.status = "completed";
    expect(await poll()).toEqual([{ projectId: project.id, activeLeaders: 0, activeCrew: 0 }]);
  });

  it.each([{}, { projectIds: [4] }, { projectIds: [""] },
    { projectIds: Array.from({ length: 101 }, (_, i) => `p${i}`) },
    { projectIds: ["p"], includeArchived: true },
  ])("rejects invalid or excessive scopes before constructing any summary: %j", async (body) => {
    const h = setup();
    expect((await h.request(body)).status).toBe(400);
    expect(h.summarize).not.toHaveBeenCalled();
  });
});
