import express, { Router } from "express";
import { describe, expect, it, vi } from "vitest";
import { mountProjectActivityRoute } from "../../server/routes/projects/activity.ts";
import { createExpressFetch } from "../harness/in-process-http.ts";

function setup() {
  const summarize = vi.fn((ids: string[]) => ids.map((projectId) => ({ projectId, activeSessions: 2 })));
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
      { projectId: "p1", activeSessions: 2 }, { projectId: "p2", activeSessions: 2 },
    ]);
    expect(h.summarize).toHaveBeenCalledWith(["p1", "p2"]);
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
