import { expect, it } from "vitest";
import { projectStatus } from "./project-status.ts";
import { libraryProject, summary } from "./test-fixture.ts";

it("describes only fresh, authoritative attention reasons with correct plurality", () => {
  const project = libraryProject(), now = Date.now();
  const data = summary({ state: "attention", attention: { total: 6, decision: 1, review: 2, conflict: 3 } });
  expect(projectStatus(project, data, now).attentionDetail).toBe("1 decision · 2 reviews · 3 conflicts");
  expect(projectStatus(project, { ...data, attention: { total: 1, decision: 0, review: 1, conflict: 0 } }, now).attentionDetail).toBe("1 review");
  expect(projectStatus(project, { ...data, attention: { total: 1, decision: 0, review: 0, conflict: 0 } }, now)).toMatchObject({ label: "Needs attention", attentionDetail: "" });
  for (const unavailable of [{ ...data, expiresAt: "2000-01-01" }, { ...data, state: "unknown" as const }, { ...data, projectId: "other" }]) {
    expect(projectStatus(project, unavailable, now).attentionDetail).toBe("");
  }
  expect(projectStatus({ ...project, archived: true }, data, now).attentionDetail).toBe("");
});

it("does not confuse unread, waiting, unknown execution or concurrent attention with running", () => {
  const project = libraryProject(), now = Date.now();
  expect(projectStatus(project, summary({ state: "running", running: false, unread: 2, activeWorkItems: 1 }), now)).toMatchObject({ state: "waiting", unread: 2, running: false });
  expect(projectStatus(project, summary({ state: "running", running: null }), now)).toMatchObject({ state: "unknown", running: false });
  expect(projectStatus(project, summary({ state: "running", running: true, attention: { total: 1, review: 1, decision: 0, conflict: 0 } }), now)).toMatchObject({ state: "running", attentionCount: 1, attentionDetail: "1 review" });
});
