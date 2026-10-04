import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ThinkingStream } from "./ThinkingStream.tsx";

it("updates a single prose text node as fragments arrive, including fragments inside words", () => {
  const { rerender } = render(<ThinkingStream text="I need to in" effort="high" />);
  const body = screen.getByLabelText("Streaming thinking");
  rerender(<ThinkingStream text="I need to inspect this." effort="high" />);
  expect(screen.getByLabelText("Streaming thinking")).toBe(body);
  expect(body.childNodes).toHaveLength(1);
  expect(body.textContent).toBe("I need to inspect this.");
  expect(screen.getByText("high")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Thinking/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
});

it("preserves paragraph boundaries and fills the available width without a nested scrolling box", () => {
  render(<ThinkingStream text={"First paragraph.\n\nSecond paragraph."} density="compact" />);
  const body = screen.getByLabelText("Streaming thinking");
  expect(body.textContent).toBe("First paragraph.\n\nSecond paragraph.");
  expect(body).toHaveStyle({ whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  expect(body.parentElement).toHaveStyle({ width: "100%", minWidth: "0", boxSizing: "border-box" });
  expect(body.style.maxHeight).toBe("");
});
