import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SelectableMessageBubble } from "./SelectableMessageBubble.tsx";
import type { MessageContextSelection } from "../types.ts";

function SelectionProbe() {
  const [selection, setSelection] = useState<MessageContextSelection | null>(null);
  return <SelectableMessageBubble
    msg={{ id: "fullscreen-message", role: "assistant", content: "First\n\nSecond\n\nThird", timestamp: 0 }}
    selection={selection}
    onActivate={messageId => setSelection({ messageId, selectedChunkIds: [], anchorChunkId: null })}
    onSelectionChange={setSelection} onExit={() => setSelection(null)} />;
}

function setup() {
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const { container, unmount } = render(
    <div className="leader-fs-messages" data-selection-viewport="fullscreen" tabIndex={0}>
      <SelectionProbe />
    </div>,
  );
  const feed = container.firstElementChild as HTMLElement;
  const toolbar = container.querySelector<HTMLElement>(".message-selection-toolbar")!;
  const controls = container.querySelector<HTMLElement>(".message-selection-toolbar__controls")!;
  const chunks = screen.getAllByTestId("message-chunk");
  let scroll = 0;
  let height = 300;
  const rect = (top: number, h: number) => ({ top: 100 + top, bottom: 100 + top + h, height: h }) as DOMRect;
  Object.defineProperties(feed, { clientHeight: { get: () => height }, clientTop: { value: 0 } });
  Object.defineProperty(toolbar, "offsetHeight", { value: 40 });
  vi.spyOn(feed, "getBoundingClientRect").mockImplementation(() => rect(0, height));
  vi.spyOn(toolbar, "getBoundingClientRect").mockImplementation(() => rect(1300 - scroll, 40));
  chunks.forEach((chunk, index) => {
    vi.spyOn(chunk, "getBoundingClientRect").mockImplementation(() => rect(50 + index * 500 - scroll, 100));
  });
  return {
    feed, toolbar, controls, chunks, disconnect, unmount,
    top: () => toolbar.getBoundingClientRect().top + Number(controls.style.transform.match(/translateY\((.*)px\)/)?.[1]),
    scrollTo: (value: number) => { scroll = value; fireEvent.scroll(feed); },
    resizeTo: (value: number) => { height = value; resize(); },
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("places fullscreen controls below the last visible selected chunk and clamps on resize", () => {
  const ui = setup();
  fireEvent.click(ui.chunks[0]!);
  expect(ui.top()).toBe(254); // selected bottom 250 + 4px gap
  expect(ui.controls).toBeVisible();
  ui.resizeTo(180);
  expect(ui.top()).toBe(236); // viewport bottom 280 - 4px inset - 40px toolbar
  ui.resizeTo(300);
  expect(ui.top()).toBe(254);
  ui.scrollTo(100); // selection is partially above the viewport
  expect(ui.top()).toBe(154);
  ui.scrollTo(149); // even the final pixel keeps controls available, inset from the top
  expect(ui.top()).toBe(105);
});

it("hides inaccessible controls outside the selection, preserving it when scrolling back", () => {
  const ui = setup();
  fireEvent.click(ui.chunks[0]!);
  const copy = screen.getByRole("button", { name: "Copy selected chunks" });
  copy.focus();
  ui.scrollTo(150); // selected chunk ends exactly at the viewport top
  expect(ui.controls).not.toBeVisible();
  expect(ui.controls).toHaveAttribute("inert");
  expect(ui.controls).toHaveAttribute("aria-hidden", "true");
  expect(screen.queryByRole("button", { name: "Copy selected chunks" })).not.toBeInTheDocument();
  expect(ui.feed).toHaveFocus();
  expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
  ui.scrollTo(0);
  expect(ui.controls).toBeVisible();
  expect(ui.controls).not.toHaveAttribute("inert");
  expect(screen.getByRole("button", { name: "Copy selected chunks" })).toBeEnabled();
  ui.scrollTo(-250); // selected chunk begins exactly at the viewport bottom
  expect(ui.controls).not.toBeVisible();
});

it("uses visible selected chunks rather than the bounding span of a disjoint selection", () => {
  const ui = setup();
  fireEvent.click(ui.chunks[0]!);
  fireEvent.click(ui.chunks[2]!);
  expect(ui.top()).toBe(254); // third chunk is below the viewport
  ui.scrollTo(500); // only the unselected middle chunk is visible
  expect(ui.controls).not.toBeVisible();
  ui.scrollTo(1000);
  expect(ui.controls).toBeVisible();
  expect(ui.top()).toBe(254);
  expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
  expect(screen.getAllByRole("checkbox")[2]).toBeChecked();
});

it("keeps empty-selection mode usable and clears positioning/visibility on exit", () => {
  const ui = setup();
  fireEvent.click(ui.chunks[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Clear selected chunks" }));
  expect(ui.controls).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy selected chunks" })).toBeDisabled();
  ui.scrollTo(500);
  expect(ui.controls).toBeVisible();
  expect(ui.top()).toBe(254);
  fireEvent.click(screen.getByRole("button", { name: "Exit chunk selection" }));
  expect(ui.toolbar).toHaveStyle({ visibility: "hidden" });
  expect(ui.controls.style.transform).toBe("");
  ui.scrollTo(0);
  expect(ui.controls.style.transform).toBe("");
  expect(ui.disconnect).toHaveBeenCalled();
  ui.unmount();
});
