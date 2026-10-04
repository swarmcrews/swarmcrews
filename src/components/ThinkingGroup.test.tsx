import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ThinkingGroup } from "./ThinkingGroup.tsx";

it("keeps completed blocks collapsible and preserves their block separators", () => {
  render(<ThinkingGroup msgs={[
    { id: "a", role: "thinking", content: "First block", timestamp: 1 },
    { id: "b", role: "thinking", content: "Second block", timestamp: 2 },
  ]} />);
  const toggle = screen.getByRole("button", { name: /Thinking/ });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(/First block/).textContent).toBe("First block\n\nSecond block");
});
