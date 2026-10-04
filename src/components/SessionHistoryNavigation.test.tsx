import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DisplayMessage } from "../sdk-messages.ts";
import { groupMessages } from "../nodes/leader-message-helpers.ts";
import { LEADER_DEFAULT_DATA } from "../nodes/leader/types.ts";
import { LeaderMessageFeed } from "../nodes/leader/messages/LeaderMessageFeed.tsx";
import { SessionTranscript } from "./SessionTranscript.tsx";

const surfaces = {
  leader: (messages: DisplayMessage[]) => <LeaderMessageFeed outputRef={{ current: null }}
    data={{ ...LEADER_DEFAULT_DATA, messages }} groupedMessages={groupMessages(messages)}
    messageContextSelection={null} onActivateMessageSelection={vi.fn()}
    onMessageSelectionChange={vi.fn()} onExitMessageSelection={vi.fn()} debugEnabled={false} isWorking={false} />,
  transcript: (messages: DisplayMessage[]) => <SessionTranscript messages={messages} streamingText="" />,
};

for (const [name, surface] of Object.entries(surfaces)) {
  describe(`${name} history navigation`, () => {
    it.each([
      ["Read session history", "/api/history/run-00000000-0000-4000-8000-000000000001"],
      ["Read earlier session history", "/api/history/run-1?before=3"],
    ])("renders %s as navigation rather than a raw system message", (label, href) => {
      const content = `[${label}](${href})`;
      render(surface([{ id: "lm-archive", role: "system", content, timestamp: 0 }]));
      const navigation = screen.getByRole("navigation", { name: "Session history" });
      const link = within(navigation).getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(screen.queryByText(content)).not.toBeInTheDocument();
      expect(navigation.querySelector("time")).toBeNull();
      expect(screen.queryByText("System")).not.toBeInTheDocument();
    });

    it("preserves user discussion of history links and ordinary system messages", () => {
      const content = "[Read session history](/api/history/run-1)";
      render(surface([
        { id: "user", role: "user", content, timestamp: 1 },
        { id: "system", role: "system", content: "Continued in a fresh thread at a context checkpoint.", timestamp: 2 },
      ]));
      expect(screen.queryByRole("navigation", { name: "Session history" })).not.toBeInTheDocument();
      expect(screen.getByText("Continued in a fresh thread at a context checkpoint.")).toBeInTheDocument();
      expect(screen.getByText(content)).toBeInTheDocument();
    });

    it("does not promote arbitrary system links to history navigation", () => {
      const content = "[Read session history](https://example.com)";
      render(surface([{ id: "system", role: "system", content, timestamp: 1 }]));
      expect(screen.queryByRole("navigation", { name: "Session history" })).not.toBeInTheDocument();
      expect(screen.getByText(content)).toBeInTheDocument();
    });
  });
}
