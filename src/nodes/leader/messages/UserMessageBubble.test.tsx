import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { UserMessageBubble } from "./UserMessageBubble.tsx";
import { groupTranscript } from "../../../components/SessionTranscript.tsx";
import { normalizedToDisplayMessages } from "../../../sdk-messages.ts";

it("shows the reported startup model below user context without altering the prompt", () => {
  const groups = groupTranscript([
    { id: "prompt", role: "user", content: "Build this", timestamp: 1 },
    ...normalizedToDisplayMessages({ kind: "init", model: "reported-model", sessionId: "session" }),
  ]);
  expect(groups).toHaveLength(1);
  const group = groups[0]!;
  if (group.kind !== "single") throw new Error("Expected user message");
  expect(group.msg.content).toBe("Build this");
  const { container } = render(<UserMessageBubble msg={group.msg} />);
  expect(screen.getByText("Model: reported-model").closest(".leader-message-meta")).toBeInTheDocument();
  expect(container).toHaveTextContent("Build this");
});
