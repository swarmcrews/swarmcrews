import { describe, expect, it } from "vitest";
import { approvalChildrenSchema, MAX_APPROVAL_CHILDREN } from "./session-crew.ts";

const child = { sessionKey: "child", taskId: "task", title: "Child", attemptId: "attempt", attemptNumber: 1 };
describe("approval-only canonical child contract", () => {
  it("bounds the projection and requires durable attempt identity", () => {
    expect(approvalChildrenSchema.safeParse(Array(MAX_APPROVAL_CHILDREN).fill(child)).success).toBe(true);
    expect(approvalChildrenSchema.safeParse(Array(MAX_APPROVAL_CHILDREN + 1).fill(child)).success).toBe(false);
    for (const patch of [{ attemptId: "" }, { attemptNumber: 0 }, { sessionKey: "" }, { title: "x".repeat(257) }]) {
      expect(approvalChildrenSchema.safeParse([{ ...child, ...patch }]).success).toBe(false);
    }
  });
});
