import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import type { DisplayMessage } from "../sdk-messages.ts";
import { SessionTranscript } from "./SessionTranscript.tsx";
import { ChatLinkScope } from "./ChatLink.tsx";
import type { TranscriptEntry } from "./SessionTranscript.tsx";

it("renders iteration boundaries as navigable dividers and keeps tool groups in their run", () => {
  const messages: TranscriptEntry[] = [
    { kind: "run-boundary", id: "first", label: "Iteration 1", content: "Iteration 1 · completed" },
    { id: "tool-1", role: "tool", toolName: "Read", content: "First file", timestamp: 1 },
    { kind: "run-boundary", id: "second", label: "Iteration 2", content: "Iteration 2 · Active now" },
    { id: "tool-2", role: "tool", toolName: "Read", content: "Second file", timestamp: 2 },
  ];
  const { container, rerender } = render(<SessionTranscript messages={messages} streamingText="" />);
  const first = screen.getByRole("navigation", { name: "Iteration 1 navigation" });
  const second = screen.getByRole("navigation", { name: "Iteration 2 navigation" });
  const next = within(first).getByRole("link", { name: "Next: Iteration 2" });
  expect(decodeURIComponent(next.getAttribute("href")!.slice(1))).toBe(second.id);
  expect(within(first).queryByRole("link", { name: /Previous/ })).not.toBeInTheDocument();
  expect(within(second).queryByRole("link", { name: /Next/ })).not.toBeInTheDocument();
  expect(container.querySelector(".act-tx-msg")).not.toBeInTheDocument();
  expect(container.querySelectorAll(".act-tx-toolchip")).toHaveLength(2);

  fireEvent.click(next);
  expect(second).toHaveFocus();
  fireEvent.click(within(second).getByRole("link", { name: "Previous: Iteration 1" }));
  expect(first).toHaveFocus();

  const id = first.id;
  rerender(<SessionTranscript messages={messages} streamingText="New output" />);
  expect(screen.getByRole("navigation", { name: "Iteration 1 navigation" }).id).toBe(id);
  expect(first).toHaveFocus();
});

it("scopes iteration anchors to each mounted transcript", () => {
  const messages: TranscriptEntry[] = [
    { kind: "run-boundary", id: "same-run", label: "Iteration 1", content: "Iteration 1 · completed" },
  ];
  render(<><SessionTranscript messages={messages} streamingText="" />
    <SessionTranscript messages={messages} streamingText="" /></>);
  const boundaries = screen.getAllByRole("navigation");
  expect(boundaries[0]!.id).not.toBe(boundaries[1]!.id);
  for (const boundary of boundaries) {
    const link = within(boundary).getByRole("link") as HTMLAnchorElement;
    expect(decodeURIComponent(link.hash.slice(1))).toBe(boundary.id);
  }
});

it("formats agent verdicts while preserving user JSON in the transcript", () => {
  const content = JSON.stringify({ result: "inconclusive", confidence: 0.98, summary: "Host checks unavailable." });
  render(<SessionTranscript messages={[
    { id: "user", role: "user", content, timestamp: 1 },
    { id: "agent", role: "assistant", content, timestamp: 2 },
    { id: "result", role: "result", content, timestamp: 3 },
  ]} streamingText="" />);
  expect(screen.getAllByText("Verification: Inconclusive")).toHaveLength(2);
  expect(screen.getByText(content)).toBeInTheDocument();
});

it("makes completed and streaming agent file links navigable in Activity", () => {
  render(<ChatLinkScope project="workspace" cwd="/repo/worktree">
    <SessionTranscript messages={[{ id: "a", role: "assistant", content: "[Source](src/a.ts:5)", timestamp: 1 }]}
      streamingText="[Notes](notes.md)" />
  </ChatLinkScope>);
  for (const label of ["Source", "Notes"]) {
    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("href")).toContain("/file-view?project=workspace");
  }
});

it("shows message timestamps in the Activity transcript", () => {
  const timestamp = new Date("2026-07-29T15:42:00.000Z").getTime();
  const messages: DisplayMessage[] = [{
    id: "assistant-1",
    role: "assistant",
    content: "The focused checks passed.",
    timestamp,
  }];

  const { container } = render(
    <SessionTranscript messages={messages} streamingText="" />,
  );

  expect(container.querySelector(".act-tx-msg time")).toHaveAttribute(
    "datetime",
    "2026-07-29T15:42:00.000Z",
  );
});

it("moves startup models into their own iteration headers without hiding system notices", () => {
  const init = (model: string): DisplayMessage => ({ id: model, role: "system",
    content: `Session on ${model}`, sessionModel: model, timestamp: 1 });
  const messages: TranscriptEntry[] = [
    { kind: "run-boundary", id: "one", label: "Iteration 1", content: "Iteration 1 · completed" },
    init("model-one"),
    { id: "notice", role: "system", content: "Retrying connection", timestamp: 2 },
    { kind: "run-boundary", id: "two", label: "Iteration 2", content: "Iteration 2 · Active now" },
    { id: "user", role: "user", content: "Continue", timestamp: 3 },
  ];
  const { rerender } = render(<SessionTranscript messages={messages} streamingText="" />);
  expect(within(screen.getByRole("navigation", { name: "Iteration 1 navigation" }))
    .getByText("Iteration 1 · completed · model-one")).toBeInTheDocument();
  expect(screen.queryByText("Session on model-one")).not.toBeInTheDocument();
  expect(screen.getByText("Retrying connection")).toBeInTheDocument();
  rerender(<SessionTranscript messages={[...messages, init("model-two")]} streamingText="" />);
  expect(within(screen.getByRole("navigation", { name: "Iteration 2 navigation" }))
    .getByText("Iteration 2 · Active now · model-two")).toBeInTheDocument();
  expect(messages[0]?.content).toBe("Iteration 1 · completed");
});

it("shows the startup model as user context when there is no iteration header", () => {
  render(<SessionTranscript messages={[
    { id: "init", role: "system", content: "Session on model-one", sessionModel: "model-one", timestamp: 1 },
    { id: "user", role: "user", content: "Build this", timestamp: 2 },
  ]} streamingText="" />);
  expect(screen.getByText("Model: model-one").closest(".act-tx-msg--user")).toBeInTheDocument();
  expect(screen.queryByText("Session on model-one")).not.toBeInTheDocument();
});

it("renders the explicit thinking preview separately from assistant text and the generic waiting state", () => {
  const { rerender } = render(<SessionTranscript messages={[]} streamingText="Answer"
    streamingThinkingText="Continuous thought" thinking />);
  expect(screen.getByLabelText("Streaming thinking")).toHaveTextContent("Continuous thought");
  expect(screen.getByText("Answer")).toBeInTheDocument();
  expect(screen.queryByText("Leader is thinking…")).not.toBeInTheDocument();
  rerender(<SessionTranscript messages={[
    { id: "thought", role: "thinking", content: "Continuous thought", timestamp: 1 },
  ]} streamingText="" streamingThinkingText="" />);
  expect(screen.queryByLabelText("Streaming thinking")).not.toBeInTheDocument();
  expect(screen.getAllByText("Continuous thought")).toHaveLength(1);
});
