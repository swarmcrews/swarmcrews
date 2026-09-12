import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CanvasNodeContent } from "./CanvasNodeContent.tsx";
import type { NodeRenderProps } from "./types.ts";

it("preserves live state, data, size and callbacks while skipping hidden position updates", () => {
  const renderer = vi.fn(({ node, onUpdateData }: NodeRenderProps) => {
    const [count, setCount] = useState(0);
    return <>
      <output>{`${node.id}:${node.position.x}:${node.size.width}:${node.data}`}</output>
      <button onClick={() => { setCount(count + 1); onUpdateData(count); }}>{count}</button>
    </>;
  });
  let props = {
    renderer, hiddenForDrag: true, isSelected: false, onUpdateData: vi.fn(),
    node: { id: "leader", type: "leader", position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, data: "running" },
  };
  const { rerender } = render(<CanvasNodeContent {...props} />);
  const button = screen.getByRole("button");
  props = { ...props, node: { ...props.node, position: { x: 50, y: 0 } } };
  rerender(<CanvasNodeContent {...props} />);
  expect(renderer).toHaveBeenCalledTimes(1);
  fireEvent.click(button);
  expect(button).toHaveTextContent("1");
  const onUpdateData = vi.fn();
  props = { ...props, onUpdateData, node: { ...props.node, data: "waiting", size: { width: 200, height: 100 } } };
  rerender(<CanvasNodeContent {...props} />);
  expect(screen.getByText("leader:50:200:waiting")).toBeInTheDocument();
  fireEvent.click(button);
  expect(onUpdateData).toHaveBeenCalledWith(1);
  props = { ...props, hiddenForDrag: false, node: { ...props.node, position: { x: 75, y: 0 } } };
  rerender(<CanvasNodeContent {...props} />);
  expect(screen.getByText("leader:75:200:waiting")).toBeInTheDocument();
  expect(screen.getByRole("button")).toBe(button);
  expect(button).toHaveTextContent("2");
  props = { ...props, node: { ...props.node, position: { x: 90, y: 0 } } };
  rerender(<CanvasNodeContent {...props} />);
  expect(screen.getByText("leader:90:200:waiting")).toBeInTheDocument();
});
