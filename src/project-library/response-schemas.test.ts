import { expect, it } from "vitest";
import { activitySchema } from "./response-schemas.ts";
const record = { projectId: "alpha", leaders: [], checkedAt: "2026-01-01", expiresAt: "2026-01-02", recent: { id: "event", projectId: "alpha", workItemId: null, revision: 1, text: "Recorded change", at: 1, kind: "context", unread: false, destination: { view: "context" } } };
it("validates bounded, project-owned historical activity without runtime fields", () => {
  expect(activitySchema.safeParse([record]).success).toBe(true);
  expect(activitySchema.safeParse([{ ...record, recent: null }]).success).toBe(true);
  expect(activitySchema.safeParse(Array(101).fill(record)).success).toBe(false);
  expect(activitySchema.safeParse([{ ...record, projectId: "other" }]).success).toBe(false);
  expect(activitySchema.safeParse([{ ...record, recent: { ...record.recent, at: 1e100 } }]).success).toBe(false);
});

it("rejects excess or duplicate leader previews and invalid item timestamps", () => {
  const leader = { workItemId: "work", title: "Leader", at: 1 };
  expect(activitySchema.safeParse([{ ...record, leaders: [leader] }]).success).toBe(true);
  expect(activitySchema.safeParse([{ ...record, leaders: [leader, leader] }]).success).toBe(false);
  expect(activitySchema.safeParse([{ ...record, leaders: Array.from({ length: 4 }, (_, i) => ({ ...leader, workItemId: String(i) })) }]).success).toBe(false);
  expect(activitySchema.safeParse([{ ...record, leaders: [{ ...leader, at: 1e100 }] }]).success).toBe(false);
});
