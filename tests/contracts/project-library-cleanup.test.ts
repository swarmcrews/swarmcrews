import fs from "node:fs";
import express, { Router } from "express";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountLibraryRoutes } from "../../server/project-library/routes.ts";
import { libraryFixture, runtimeFixture, workspaceFixture, quietRuntime, itemFixture, changeItem } from "../../server/project-library/test-fixture.ts";
import { createExpressFetch } from "../harness/in-process-http.ts";
import { createApiAuthMiddleware } from "../../server/http-security.ts";
let fixture: ReturnType<typeof libraryFixture>; let runtime: ReturnType<typeof runtimeFixture>;
let workspace: ReturnType<typeof workspaceFixture>; let fetch: typeof globalThis.fetch;
beforeEach(() => {
  fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home); runtime = runtimeFixture(fixture.root); workspace = workspaceFixture(fixture.root);
  const router = Router(); mountLibraryRoutes(router, { runtimeDb: () => runtime, runtimeReader: quietRuntime });
  const app = express(); app.use(express.json()); app.use("/api/projects", createApiAuthMiddleware("test-token"), router); fetch = createExpressFetch(app);
});
afterEach(() => { runtime.close(); vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
const request = (action: string, body: unknown, auth = true) => fetch(`http://in-process.local/api/projects/library/missing-folders/${action}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer test-token" } : {}) }, body: JSON.stringify(body),
});
it("authenticates, validates and bounds scan/cleanup requests", async () => {
  const project = { id: workspace.id, expectedRevision: 0 };
  expect((await request("scan", { projectIds: [workspace.id] }, false)).status).toBe(401);
  expect((await request("cleanup", { projects: [project] }, false)).status).toBe(401);
  for (const body of [{ projects: [] }, { projects: [project, project] }, { projects: [{ ...project, expectedRevision: -1 }] }, { projects: [project], force: true }])
    expect((await request("cleanup", body)).status).toBe(400);
  expect((await request("scan", { projectIds: Array(101).fill(workspace.id) })).status).toBe(400);
  expect((await request("scan", { projectIds: ["invalid"] })).status).toBe(400);
});
it("returns per-project outcomes, preserving existing, active and changed projects", async () => {
  const active = workspaceFixture(fixture.root, "Active"); const existing = workspaceFixture(fixture.root, "Existing");
  itemFixture(runtime, active, "work"); changeItem(runtime, "work", { runtime: "working" });
  fs.rmSync(workspace.sourceRoot, { recursive: true }); fs.rmSync(active.sourceRoot, { recursive: true });
  const scan = await request("scan", { projectIds: [workspace.id, active.id, existing.id] });
  expect(scan.headers.get("cache-control")).toBe("no-store");
  expect(await scan.json()).toEqual([{ id: workspace.id, revision: 0, eligible: true }, { id: active.id, revision: 0, eligible: false }]);
  const cleanup = await request("cleanup", { projects: [workspace, active, existing].map(p => ({ id: p.id, expectedRevision: 0 })) });
  expect(cleanup.status).toBe(200);
  expect(await cleanup.json()).toEqual({ archived: [workspace.id], skipped: [
    { id: active.id, reason: expect.stringMatching(/work/) }, { id: existing.id, reason: expect.stringMatching(/missing/) },
  ] });
  expect(fs.existsSync(existing.sourceRoot)).toBe(true); expect(fs.existsSync(workspace.stateRoot)).toBe(true);
  expect(await (await request("scan", { projectIds: [workspace.id] })).json()).toEqual([]);
});
