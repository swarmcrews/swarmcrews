import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { SelectableMessageBubble } from "./SelectableMessageBubble.tsx";
import type { LeaderMessage, MessageContextSelection } from "../types.ts";

const originalClipboard = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  "clipboard",
);

function setClipboard(value: unknown): void {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  if (originalClipboard) {
    Object.defineProperty(globalThis.navigator, "clipboard", originalClipboard);
  } else {
    setClipboard(undefined);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  JSON.stringify({ result: "inconclusive", confidence: 0.98, summary: "Host checks unavailable." }),
  '{\n  "summary": "Host checks unavailable.",\n\n  "checks": ["Build passed"]\n}',
])("renders a readable report and copies its original JSON: %s", async content => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  setClipboard({ writeText });
  const onActivate = vi.fn();
  render(<SelectableMessageBubble msg={{ ...msg, content }} selection={null}
    onActivate={onActivate} onSelectionChange={() => {}} onExit={() => {}} />);
  expect(screen.getByText("Host checks unavailable.")).not.toBeVisible();
  fireEvent.click(screen.getByText("View report details"));
  expect(screen.getByText("Host checks unavailable.")).toBeVisible();
  expect(onActivate).not.toHaveBeenCalled();
  expect(screen.getAllByTestId("message-chunk")).toHaveLength(1);
  fireEvent.click(screen.getByTitle("Copy to clipboard"));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(content));
});

it("leaves selection mode closed when a nested action receives Enter or Space", () => {
  const onActivate = vi.fn();
  render(<SelectableMessageBubble msg={msg} selection={null} onActivate={onActivate}
    onSelectionChange={() => {}} onExit={() => {}} />);

  const copy = screen.getByTitle("Copy to clipboard");
  expect(fireEvent.keyDown(copy, { key: "Enter" })).toBe(true);
  expect(fireEvent.keyDown(copy, { key: " " })).toBe(true);
  expect(onActivate).not.toHaveBeenCalled();

  fireEvent.keyDown(screen.getByTestId("selectable-message"), { key: "Enter" });
  expect(onActivate).toHaveBeenCalledWith(msg.id);
});

it.each([false, true])("preserves native text selection instead of picking chunks (active: %s)", (active) => {
  const onActivate = vi.fn();
  const onSelectionChange = vi.fn();
  render(<SelectableMessageBubble msg={msg} selection={active ? activeSelection : null}
    onActivate={onActivate} onSelectionChange={onSelectionChange} onExit={() => {}} />);

  const range = document.createRange();
  range.selectNodeContents(screen.getByText("hello world"));
  window.getSelection()?.addRange(range);
  fireEvent.click(screen.getByTestId("message-chunk"));
  expect(window.getSelection()?.toString()).toBe("hello world");
  expect(onActivate).not.toHaveBeenCalled();
  expect(onSelectionChange).not.toHaveBeenCalled();
});

function SelectionProbe() {
  const [selection, setSelection] = useState<MessageContextSelection | null>(null);
  return <SelectableMessageBubble msg={{ ...msg, content: "First\n\nSecond\n\nThird" }}
    selection={selection}
    onActivate={(messageId) => setSelection({ messageId, selectedChunkIds: [], anchorChunkId: null })}
    onSelectionChange={setSelection} onExit={() => setSelection(null)} />;
}

it("selects a chunk on the first click and keeps the footer in the layout when closed", () => {
  const { container } = render(<SelectionProbe />);
  const footer = container.querySelector(".message-selection-toolbar")!;
  expect(footer).toHaveStyle({ visibility: "hidden" });
  fireEvent.click(screen.getAllByTestId("message-chunk")[1]!);
  expect(screen.getAllByRole("checkbox")[1]).toBeChecked();
  expect(footer).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Exit chunk selection" }));
  expect(container.querySelector(".message-selection-toolbar")).toBe(footer);
  expect(footer).toHaveStyle({ visibility: "hidden" });
  expect(footer).toHaveAttribute("inert");
});

it("supports keyboard picking, shift ranges, clearing, and returning focus on Escape", () => {
  render(<SelectionProbe />);
  const message = screen.getByTestId("selectable-message");
  fireEvent.keyDown(message, { key: " " });
  const chunks = screen.getAllByRole("checkbox");
  fireEvent.keyDown(chunks[0]!, { key: " " });
  expect(fireEvent.mouseDown(chunks[2]!, { shiftKey: true })).toBe(false);
  fireEvent.click(chunks[2]!, { shiftKey: true });
  chunks.forEach((chunk) => expect(chunk).toBeChecked());
  fireEvent.click(screen.getByRole("button", { name: "Clear selected chunks" }));
  chunks.forEach((chunk) => expect(chunk).not.toBeChecked());
  expect(screen.getByRole("button", { name: "Copy selected chunks" })).toBeDisabled();

  chunks[1]!.focus();
  fireEvent.keyDown(chunks[1]!, { key: "Enter" });
  expect(chunks[1]).toBeChecked();
  fireEvent.keyDown(chunks[1]!, { key: "Escape" });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(message).toHaveFocus();
});

it.each([0.5, 1, 1.5])("keeps the toolbar inside the selected range while scrolling at zoom %s", scale => {
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const { container } = render(<div className="leader-message-feed"><SelectionProbe /></div>);
  const feed = container.firstElementChild as HTMLElement;
  const toolbar = container.querySelector<HTMLElement>(".message-selection-toolbar")!;
  const controls = container.querySelector<HTMLElement>(".message-selection-toolbar__controls")!;
  const chunks = screen.getAllByTestId("message-chunk");
  let scroll = 500;
  let viewportHeight = 300;
  const rect = (top: number, height: number) => ({
    top: 100 + top * scale, bottom: 100 + (top + height) * scale, height: height * scale,
  }) as DOMRect;
  Object.defineProperties(feed, {
    clientHeight: { get: () => viewportHeight },
    clientTop: { value: 0 },
  });
  Object.defineProperty(toolbar, "offsetHeight", { value: 40 });
  vi.spyOn(feed, "getBoundingClientRect").mockImplementation(() => rect(0, viewportHeight));
  vi.spyOn(toolbar, "getBoundingClientRect").mockImplementation(() => rect(2000 - scroll, 40));
  chunks.forEach((chunk, index) => {
    vi.spyOn(chunk, "getBoundingClientRect").mockImplementation(() => rect(400 + index * 400 - scroll, 200));
  });
  const controlsTop = () => toolbar.getBoundingClientRect().top
    + Number(controls.style.transform.match(/translateY\((.*)px\)/)?.[1]) * scale;
  const controlsBottom = () => controlsTop() + 40 * scale;

  fireEvent.click(chunks[0]!);
  fireEvent.click(chunks[2]!, { shiftKey: true });
  expect(controlsBottom()).toBeCloseTo(100 + (viewportHeight - 4) * scale);

  // Resizing the chat moves the toolbar without requiring another scroll.
  viewportHeight = 250;
  resize();
  expect(controlsBottom()).toBeCloseTo(100 + (viewportHeight - 4) * scale);

  // The end of the selection holds the toolbar as it scrolls out above chat.
  for (scroll of [1200, 1500]) {
    fireEvent.scroll(feed);
    expect(controlsBottom()).toBeCloseTo(chunks[2]!.getBoundingClientRect().bottom);
  }
  // Scrolling back before the selection anchors it to the first chunk.
  scroll = 0;
  fireEvent.scroll(feed);
  expect(controlsTop()).toBeCloseTo(chunks[0]!.getBoundingClientRect().top);

  // A smaller selection updates the bounds immediately.
  fireEvent.click(screen.getByRole("button", { name: "Clear selected chunks" }));
  scroll = 800;
  fireEvent.click(chunks[1]!);
  expect(controlsBottom()).toBeCloseTo(chunks[1]!.getBoundingClientRect().bottom);

  fireEvent.click(screen.getByRole("button", { name: "Exit chunk selection" }));
  expect(controls.style.transform).toBe("");
  fireEvent.scroll(feed);
  expect(controls.style.transform).toBe("");
  expect(disconnect).toHaveBeenCalled();
});

it("returns focus to the message when the selection toolbar is dismissed", () => {
  render(<SelectionProbe />);
  const message = screen.getByTestId("selectable-message");
  fireEvent.click(message);
  const exit = screen.getByRole("button", { name: "Exit chunk selection" });
  exit.focus();
  fireEvent.click(exit);
  expect(screen.queryByTestId("leader-message-selection-toolbar")).not.toBeInTheDocument();
  expect(message).toHaveFocus();
});

const msg: LeaderMessage = {
  id: "m1",
  role: "assistant",
  content: "hello world",
  timestamp: 0,
};

const activeSelection: MessageContextSelection = {
  messageId: "m1",
  selectedChunkIds: ["paragraph-0"],
  anchorChunkId: "paragraph-0",
};

it("copies selected chunks via the fallback when navigator.clipboard is undefined", async () => {
  setClipboard(undefined);
  const exec = vi.fn().mockReturnValue(true);
  (document as unknown as { execCommand: unknown }).execCommand = exec;

  render(
    <SelectableMessageBubble
      msg={msg}
      selection={activeSelection}
      onActivate={() => {}}
      onSelectionChange={() => {}}
      onExit={() => {}}
    />,
  );

  // The "hello world" message parses to a single selected chunk.
  fireEvent.click(screen.getByRole("button", { name: "Copy selected chunks" }));

  expect(exec).toHaveBeenCalledWith("copy");
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied"));
});

it("shows the message timestamp on the canvas bubble", () => {
  const timestamp = new Date("2026-07-29T15:42:00.000Z").getTime();
  const { container } = render(
    <SelectableMessageBubble
      msg={{ ...msg, timestamp }}
      selection={null}
      onActivate={() => {}}
      onSelectionChange={() => {}}
      onExit={() => {}}
    />,
  );

  expect(container.querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-07-29T15:42:00.000Z",
  );
});
