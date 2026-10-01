import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LeaderData } from "../types.ts";
import { LeaderMessageFeed } from "./LeaderMessageFeed.tsx";

function renderEmptyFeed(isWorking: boolean, streamingText = "", contentRef = { current: null as HTMLDivElement | null }) {
  return render(
    <LeaderMessageFeed
      outputRef={{ current: null }}
      contentRef={contentRef}
      data={{ sessionKey: "leader-1", messages: [], streamingText } as unknown as LeaderData}
      groupedMessages={[]}
      messageContextSelection={null}
      onActivateMessageSelection={vi.fn()}
      onMessageSelectionChange={vi.fn()}
      onExitMessageSelection={vi.fn()}
      debugEnabled={false}
      isWorking={isWorking}
    />,
  );
}

describe("Leader conversation empty state", () => {
  it("exposes the inner content for delayed-growth observation", () => {
    const contentRef = { current: null as HTMLDivElement | null };
    renderEmptyFeed(false, "An answer", contentRef);
    expect(contentRef.current).toContainElement(screen.getByText("An answer"));
    expect(contentRef.current?.parentElement).toHaveAttribute("aria-label", "Conversation messages");
  });

  it("invites a message for an idle session without claiming it is thinking", () => {
    renderEmptyFeed(false);
    expect(screen.getByRole("heading", { name: "Your conversation starts here" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Leader is working")).not.toBeInTheDocument();
    expect(screen.queryByText("Leader is thinking...")).not.toBeInTheDocument();
  });

  it("shows only the working indicator while an empty session is active", () => {
    renderEmptyFeed(true);
    expect(screen.getByLabelText("Leader is working")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("does not show the empty state when the first response is streaming", () => {
    renderEmptyFeed(false, "Reviewing the application");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("Reviewing the application")).toBeInTheDocument();
  });
});
