import { useReducer, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Canvas } from "./Canvas.tsx";
import { DockProvider } from "./BottomRightDock.tsx";
import { canvasReducer } from "./canvas-state.ts";
import "./nodes/LeaderNode.tsx";

const socketSend = vi.fn();

function Harness() {
  const [nodes, dispatch] = useReducer(canvasReducer, []);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  return <DockProvider>
    <Canvas nodes={nodes} dispatch={dispatch} graph={{ edges: [] }} graphDispatch={() => {}}
      transform={transform} setTransform={setTransform} socketSend={socketSend}
      projectId="project-1" projectPath="/tmp/project" />
  </DockProvider>;
}

beforeEach(() => {
  socketSend.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

it.each(["  Keep this context\nwith its formatting.  ", "short", ""].flatMap(description =>
  ["form", "toolbar"].map(source => ({ description, source }))))(
  "carries the empty-canvas draft $description through the $source action without starting it",
  ({ description, source }) => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "Context description" }), {
      target: { value: description },
    });
    fireEvent.click(source === "form"
      ? within(screen.getByRole("form", { name: "Start canvas with context" })).getByRole("button", { name: "Add Leader node" })
      : screen.getByTitle("Add Leader node"));

    expect(screen.queryByRole("form", { name: "Start canvas with context" })).toBeNull();
    const prompt = screen.getByRole("textbox", { name: "Leader prompt" });
    expect(prompt).toHaveValue(description);
    expect(prompt).toHaveFocus();
    fireEvent.change(prompt, { target: { value: `${description} More details` } });
    expect(prompt).toHaveValue(`${description} More details`);
    expect(socketSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: "create_work_item" }));
    expect(socketSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: "continue_work_item" }));

    fireEvent.click(screen.getByTitle("Add Leader node"));
    expect(screen.getAllByRole("textbox", { name: "Leader prompt" }).map(input =>
      (input as HTMLTextAreaElement).value)).toEqual([`${description} More details`, ""]);
  },
);
