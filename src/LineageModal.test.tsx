/**
 * Tests for <LineageModal /> — Views 2 & 3 of the lineage redesign.
 *
 * Covers:
 *   - tab rendering + switching between "This lineage" and "All lineages"
 *   - contribution row selection revealing the approve action + its payload
 *   - the all-lineages list + map-to-lineage join command
 *   - backdrop / close button / Escape all invoking onClose
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { canonicalDiff, canonicalLineageDiff, reviewSocket } from "../tests/support/canonical-review-fixture.ts";
import { LineageModal } from "./LineageModal.tsx";
import type { WorktreeLineageSnapshot } from "../shared/worktree-integration.ts";

function snapshot(overrides: Partial<WorktreeLineageSnapshot> = {}): WorktreeLineageSnapshot {
  return {
    id: "lineage-1", projectId: "project-1", repositoryPath: "/repo", targetRef: "main",
    baseSha: "base", integrationRef: "refs/minions/integration/1",
    integrationWorktreePath: "/repo/.worktrees/integration", integrationHeadSha: "head",
    revision: 3, integrationState: "active", status: "open",
    memberships: [{ workItemId: "work-1", status: "active", revision: 1, actor: "user",
      joinedAt: 1, leftAt: null }],
    resolutionRuns: [],
    contributions: [{ id: "contrib-1", lineageId: "lineage-1", workItemId: "work-1",
      originatingRunKey: "run-1", runKeys: ["run-1"], branchName: "feature",
      worktreePath: "/repo/.worktrees/feature", baseSha: "b".repeat(40), headSha: "a".repeat(40),
      revision: 2, state: "ready", reviewState: "pending", cleanupState: "retained",
      createdAt: 1, updatedAt: 2 }],
    queue: [], gates: [], reviews: [], createdAt: 1, updatedAt: 3, ...overrides,
  };
}

function renderModal(props: Partial<Parameters<typeof LineageModal>[0]> = {}) {
  const send = props.send ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  const lineage = props.lineage ?? snapshot();
  const socket = reviewSocket();
  render(
    <LineageModal
      lineage={lineage}
      workItemId={props.workItemId ?? "work-1"}
      runKey={props.runKey ?? "run-1"}
      allLineages={props.allLineages ?? [lineage]}
      send={send}
      subscribe={props.subscribe ?? socket.subscribe}
      onClose={onClose}
    />,
  );
  return { send, onClose, lineage, loadEvidence: () => {
    const request = (send as ReturnType<typeof vi.fn>).mock.calls.filter(([message]) => message.type === "get_integration_review_diff").at(-1)![0];
    act(() => socket.receive({ type: "integration_review_diff_response", lineageId: request.lineageId, contributionId: request.contributionId,
      requestId: request.requestId, success: true, diff: canonicalDiff(lineage.contributions[0]!) }));
  } };
}

function renderModalRerender(props: Partial<Parameters<typeof LineageModal>[0]> = {}) {
  const send = props.send ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  const lineage = props.lineage ?? snapshot();
  const element = (next: WorktreeLineageSnapshot) => (
    <LineageModal
      lineage={next}
      workItemId={props.workItemId ?? "work-1"}
      runKey={props.runKey ?? "run-1"}
      allLineages={props.allLineages ?? [next]}
      send={send}
      subscribe={props.subscribe}
      onClose={onClose}
    />
  );
  const view = render(element(lineage));
  return { send, onClose, rerender: (next: WorktreeLineageSnapshot) => view.rerender(element(next)) };
}

describe("<LineageModal />", () => {
  it("renders both tabs and switches to All lineages on click", () => {
    renderModal({ allLineages: [snapshot(), snapshot({ id: "lineage-2" })] });
    expect(screen.getByRole("button", { name: /This lineage/ })).toBeInTheDocument();
    const allTab = screen.getByRole("button", { name: /All lineages/ });
    expect(allTab).toBeInTheDocument();

    // This-lineage content is visible first, map block is not.
    expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
    fireEvent.click(allTab);
    expect(screen.getByRole("button", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByText("Map this leader to an active lineage")).toBeInTheDocument();
  });

  it("reveals Approve when a ready+pending contribution row is selected and sends the review", () => {
    const { send, loadEvidence } = renderModal();
    // Not visible until the row is expanded.
    expect(screen.queryByRole("button", { name: "Approve contribution" })).toBeNull();

    fireEvent.click(screen.getByText("This leader"));
    expect(screen.getByRole("button", { name: "Approve contribution" })).toBeDisabled();
    loadEvidence();
    fireEvent.click(screen.getByRole("button", { name: "Approve contribution" }));

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "review_worktree_contribution",
      contributionId: "contrib-1",
      expectedIntegrationRevision: 2,
      decision: "approved",
    }));
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "enqueue_worktree_contribution",
    }));
  });

  it.each(["loading", "failed", "ready"] as const)("keeps rejection available with %s contribution evidence without approving or integrating", (state) => {
    const socket = reviewSocket();
    const { send, lineage } = renderModal({ subscribe: socket.subscribe });
    fireEvent.click(screen.getByText("This leader"));
    const request = (send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([message]) => message.type === "get_integration_review_diff" && message.contributionId === "contrib-1").at(-1)![0];
    if (state !== "loading") {
      act(() => socket.receive({ type: "integration_review_diff_response", lineageId: lineage.id,
        contributionId: "contrib-1", requestId: request.requestId, success: state === "ready",
        ...(state === "ready" ? { diff: canonicalDiff(lineage.contributions[0]!) } : { error: "Capture unavailable" }) }));
    }
    const approval = screen.getByRole("button", { name: "Approve contribution" });
    if (state === "ready") expect(approval).toBeEnabled();
    else {
      expect(approval).toBeDisabled();
      fireEvent.click(approval);
    }
    (send as ReturnType<typeof vi.fn>).mockClear();
    const reject = screen.getByRole("button", { name: "Request contribution changes" });
    expect(reject).toBeEnabled();
    fireEvent.click(reject);
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "review_worktree_contribution", contributionId: "contrib-1",
      expectedIntegrationRevision: 2, decision: "rejected", actor: "user", summary: "Contribution needs another iteration",
      requestId: expect.any(String) }));
  });

  it("lists all lineages, marks the current one, and maps to a chosen open lineage", () => {
    const current = snapshot({ id: "lineage-1" });
    const other = snapshot({ id: "lineage-2", revision: 7, status: "open",
      contributions: [], memberships: [] });
    const closed = snapshot({ id: "lineage-3", status: "integrated" });
    const { send } = renderModal({ lineage: current,
      allLineages: [current, other, closed] });

    fireEvent.click(screen.getByRole("button", { name: /All lineages/ }));

    const currentItem = screen.getByText("current").closest(".lin3-item")!;
    expect(within(currentItem as HTMLElement).getByText(/lineage-1/)).toBeInTheDocument();
    // All three lineages listed (scope to the list — ids also appear in the select).
    const list = document.querySelector(".lin3-list") as HTMLElement;
    expect(within(list).getByText(/lineage-2/)).toBeInTheDocument();
    expect(within(list).getByText(/lineage-3/)).toBeInTheDocument();

    // Only open, non-current lineages are map candidates (lineage-2, not lineage-3).
    const select = screen.getByRole("combobox", { name: "Target lineage" }) as HTMLSelectElement;
    expect(within(select).queryByText(/lineage-3/)).toBeNull();
    fireEvent.change(select, { target: { value: "lineage-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "join_worktree_lineage",
      workItemId: "work-1",
      lineageId: "lineage-2",
      expectedIntegrationRevision: 7,
      actor: "user",
    }));
  });

  it("keeps contribution approval and enqueue as separate actions in the row detail", () => {
    // A ready+approved contribution offers Enqueue (not Approve) once the row is open.
    const { send } = renderModal({
      lineage: snapshot({
        contributions: [{ ...snapshot().contributions[0]!, reviewState: "approved" }],
      }),
    });
    fireEvent.click(screen.getByText("This leader"));
    expect(screen.queryByRole("button", { name: "Approve contribution" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enqueue contribution" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "enqueue_worktree_contribution",
      contributionId: "contrib-1",
      expectedIntegrationRevision: 2,
    }));
  });

  it("surfaces conflict recovery and pending gates for a conflicted contribution", () => {
    renderModal({
      lineage: snapshot({
        integrationState: "conflicted",
        contributions: [{ ...snapshot().contributions[0]!, state: "conflicted" }],
        gates: [{ id: "gate-1", lineageId: "lineage-1", contributionId: "contrib-1",
          scope: "contribution", name: "tests", status: "pending", details: null,
          recordedAt: 4 }],
      }),
    });
    // Lineage-level promotion conflict is shown at the tab head.
    expect(screen.getByRole("alert")).toHaveTextContent("Promotion needs another review");

    fireEvent.click(screen.getByText("This leader"));
    // Contribution-level guidance + the blocking gate are shown; a conflicted
    // contribution offers neither Approve nor Retry.
    expect(screen.getByText(/Start a new iteration/)).toBeInTheDocument();
    expect(screen.getByText("tests: pending")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve contribution" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry contribution" })).toBeNull();
  });

  it.each(["pending", "failed"] as const)("blocks an otherwise eligible enqueue on a %s gate", (status) => {
    const lineage = snapshot({
      contributions: [{ ...snapshot().contributions[0]!, reviewState: "approved" }],
      gates: [{ id: "gate", lineageId: "lineage-1", contributionId: "contrib-1",
        scope: "contribution", name: "tests", status, details: null, recordedAt: 4 }],
    });
    const { send, rerender } = renderModalRerender({ lineage });
    fireEvent.click(screen.getByText("This leader"));
    const enqueue = screen.getByRole("button", { name: "Enqueue contribution" });
    expect(enqueue).toBeDisabled();
    fireEvent.click(enqueue);
    expect(send).not.toHaveBeenCalled();
    rerender({ ...lineage, gates: [{ ...lineage.gates[0]!, status: "passed" }] });
    expect(screen.getByRole("button", { name: "Enqueue contribution" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Enqueue contribution" }));
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: "enqueue_worktree_contribution", contributionId: "contrib-1", expectedIntegrationRevision: 2,
    }));
  });

  it("keeps final review and promotion as separate actions", () => {
    const integrated = { ...snapshot().contributions[0]!, state: "integrated" as const,
      reviewState: "approved" as const };
    const review = { id: "review-1", lineageId: "lineage-1", contributionId: null,
      scope: "lineage" as const, decision: "approved" as const, actor: "user", notes: null,
      reviewedHeadSha: "c".repeat(40), recordedAt: 5 };

    // Pending final review: Approve/Reject combined, but no Promote yet.
    const socket = reviewSocket();
    const combined = snapshot({ baseSha: "b".repeat(40), integrationHeadSha: "c".repeat(40), contributions: [integrated] });
    const { send, rerender } = renderModalRerender({ lineage: combined, subscribe: socket.subscribe });
    fireEvent.click(screen.getByText("This leader"));
    expect(screen.getByRole("button", { name: "Approve combined lineage" })).toBeDisabled();
    const request = (send as ReturnType<typeof vi.fn>).mock.calls.find(([q]) => q.type === "get_integration_review_diff" && !q.contributionId)![0];
    act(() => socket.receive({ type: "integration_review_diff_response", lineageId: combined.id, contributionId: null,
      requestId: request.requestId, success: true, diff: canonicalLineageDiff(combined) }));
    fireEvent.click(screen.getByRole("button", { name: "Approve combined lineage" }));
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "promote_worktree_lineage" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "review_worktree_lineage", decision: "approved" }));

    // Once the combined head is approved, Promote appears as a distinct action
    // in the already-open row detail.
    rerender({ ...combined, reviews: [review] });
    fireEvent.click(screen.getByRole("button", { name: "Promote to main" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "promote_worktree_lineage" }));
  });

  it("hides final review and shows preserved paths while promotion is conflicted", () => {
    const integrated = { ...snapshot().contributions[0]!, state: "integrated" as const };
    renderModal({
      lineage: snapshot({ integrationState: "conflicted", contributions: [integrated],
        queue: [{ id: "queue-1", lineageId: "lineage-1", contributionId: null,
          kind: "lineage", repositoryPath: "/repo", targetRef: "main",
          expectedSourceSha: "head", expectedTargetSha: "base", state: "conflicted",
          revision: 2, attempt: 1, workerId: null, resultSha: null, fencingToken: 1,
          error: "merge conflict",
          conflictDetails: { conflicts: ["src/a.ts"],
            preservedPaths: ["/repo/.worktrees/integration"], targetSha: "base",
            sourceSha: "head" }, position: null, enqueuedAt: 2, startedAt: 3,
          finishedAt: 4, updatedAt: 4 }] }),
    });
    // Promotion needs another review blocks final review even before selecting a row.
    expect(screen.getByText(/src\/a\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/\.worktrees\/integration/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("This leader"));
    expect(screen.queryByRole("button", { name: "Approve combined lineage" })).toBeNull();
  });

  it("calls onClose from the backdrop, the close button, and Escape", () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    // The backdrop is the outermost element; clicking it (not the inner modal) closes.
    const backdrop = document.querySelector(".lin-modal__backdrop")!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

it("lets review refresh pending gates while integration stays blocked", () => {
  const { send, loadEvidence } = renderModal({ lineage: snapshot({ gates: [{ id: "gate", lineageId: "lineage-1",
    contributionId: "contrib-1", scope: "contribution", name: "tests", status: "pending", details: null, recordedAt: 1 }] }) });
  fireEvent.click(screen.getByText("This leader"));
  loadEvidence();
  const review = screen.getByRole("button", { name: "Approve contribution" });
  expect(review).toBeEnabled(); fireEvent.click(review);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "review_worktree_contribution" }));
  expect(screen.queryByRole("button", { name: "Enqueue contribution" })).toBeNull();
});

it("never approves combined changes from contribution evidence, errors, retained or superseded heads", () => {
  const socket = reviewSocket(); const send = vi.fn();
  const integrated = { ...snapshot().contributions[0]!, state: "integrated" as const, reviewState: "approved" as const };
  const combined = snapshot({ baseSha: "b".repeat(40), integrationHeadSha: "c".repeat(40), contributions: [integrated] });
  const { rerender } = renderModalRerender({ lineage: combined, send, subscribe: socket.subscribe });
  fireEvent.click(screen.getByText("This leader"));
  const approve = () => screen.getByRole("button", { name: "Approve combined lineage" });
  const reply = (diff: ReturnType<typeof canonicalDiff> | null) => {
    const q = send.mock.calls.filter(([value]) => value.type === "get_integration_review_diff" && !value.contributionId).at(-1)![0];
    act(() => socket.receive({ type: "integration_review_diff_response", lineageId: q.lineageId, contributionId: null,
      requestId: q.requestId, success: !!diff, ...(diff ? { diff } : { error: "capture failed" }) }));
  };
  expect(approve()).toBeDisabled(); reply(canonicalDiff(integrated)); expect(approve()).toBeDisabled();
  fireEvent.click(approve()); expect(send.mock.calls.some(([q]) => q.type === "review_worktree_lineage")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Refresh combined patch" })); reply(null);
  expect(approve()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh combined patch" })); reply(canonicalLineageDiff(combined));
  expect(approve()).toBeEnabled();
  const region = screen.getByRole("region", { name: "Combined lineage patch evidence" });
  fireEvent.click(within(region).getByText("combined.ts"));
  expect(within(region).getByLabelText("Patch for combined.ts")).toHaveTextContent("+combined result");
  const next = { ...combined, revision: 4, integrationHeadSha: "d".repeat(40) };
  rerender(next); expect(approve()).toBeDisabled();
  expect(within(region).getByLabelText("Patch for combined.ts")).toBeVisible();
  reply(canonicalLineageDiff(combined)); expect(approve()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh combined patch" })); reply(canonicalLineageDiff(next));
  expect(approve()).toBeEnabled(); fireEvent.click(approve());
  expect(send.mock.calls.filter(([q]) => q.type === "review_worktree_lineage")).toHaveLength(1);
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: "review_worktree_lineage", expectedIntegrationRevision: 4 });
  expect(send.mock.calls.some(([q]) => q.type === "promote_worktree_lineage")).toBe(false);
});
