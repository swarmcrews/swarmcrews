import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorktreeContributionSnapshot } from "../../../shared/worktree-integration.ts";
import { canonicalDiff, reviewSocket } from "../../../tests/support/canonical-review-fixture.ts";
import { CanonicalReview, matchesContribution, useCanonicalReview } from "./CanonicalReview.tsx";
const entry: WorktreeContributionSnapshot = { id: "contribution", lineageId: "lineage", workItemId: "work",
  originatingRunKey: "run", runKeys: ["run"], branchName: "feature", worktreePath: "/repo", baseSha: "b".repeat(40),
  headSha: "a".repeat(40), revision: 2, state: "ready", reviewState: "pending", cleanupState: "retained", createdAt: 1, updatedAt: 2 };
describe("canonical contribution evidence", () => {
  it("requires the exact contribution, revision, base/head, lineage and associated run", () => {
    const diff = canonicalDiff(entry);
    expect(matchesContribution(diff, entry)).toBe(true);
    for (const patch of [{ contributionId: "other" }, { contributionRevision: 3 }, { baseSha: "c".repeat(40) },
      { headSha: "c".repeat(40) }, { lineageId: "other" }, { runKey: "other" }, { contributionBinding: "unbound" }, { consistency: "sampled" }]) {
      expect(matchesContribution({ ...diff, snapshot: { ...diff.snapshot!, ...patch } } as typeof diff, entry)).toBe(false);
    }
  });
  it("retains failed evidence, disables stale approval, and permits explicit read-only retry", () => {
    const send = vi.fn(); const socket = reviewSocket();
    function Specimen({ contribution }: { contribution: WorktreeContributionSnapshot }) {
      const review = useCanonicalReview(contribution, send, socket.subscribe);
      return <><CanonicalReview review={review} /><button disabled={!review.ready}>Approve specimen</button></>;
    }
    const view = render(<Specimen contribution={entry} />);
    const reply = (diff: ReturnType<typeof canonicalDiff> | null) => {
      const request = send.mock.calls.at(-1)![0];
      act(() => socket.receive({ type: "integration_review_diff_response", lineageId: "lineage", contributionId: "contribution",
        requestId: request.requestId, success: !!diff, ...(diff ? { diff } : { error: "capture failed" }) }));
    };
    expect(screen.getByRole("button", { name: "Approve specimen" })).toBeDisabled();
    reply(canonicalDiff(entry));
    expect(screen.getByRole("button", { name: "Approve specimen" })).toBeEnabled();
    fireEvent.click(screen.getByText("actual.ts"));
    expect(screen.getByLabelText("Patch for actual.ts")).toHaveTextContent("+reviewed");
    view.rerender(<Specimen contribution={{ ...entry, revision: 3 }} />);
    expect(screen.getByRole("button", { name: "Approve specimen" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Loading contribution patch…" })).toBeDisabled(); reply(null);
    expect(screen.getByLabelText("Patch for actual.ts")).toHaveTextContent("+reviewed");
    expect(screen.getByText(/Retained snapshot — not current/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve specimen" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh contribution patch" })); reply(canonicalDiff({ ...entry, revision: 3 }));
    expect(screen.getByRole("button", { name: "Approve specimen" })).toBeEnabled();
    expect(send.mock.calls.every(([message]) => message.type === "get_integration_review_diff")).toBe(true);
  });
});
