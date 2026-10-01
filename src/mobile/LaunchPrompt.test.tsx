import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildSlashCommands } from "../nodes/leader/prompt/slash-commands.ts";
import { LaunchPrompt } from "./LaunchPrompt.tsx";

function Prompt({ onSelect = vi.fn() }: { onSelect?: () => void }) {
  const [value, setValue] = useState("");
  return <LaunchPrompt value={value} onChange={setValue} commands={buildSlashCommands({})} onSelect={onSelect} disabled={false} />;
}

describe("LaunchPrompt", () => {
  it("navigates with arrow keys and inserts without submitting", () => {
    const submit = vi.fn((event) => event.preventDefault());
    const select = vi.fn();
    render(<form onSubmit={submit}><Prompt onSelect={select} /></form>);
    const prompt = screen.getByLabelText("Prompt");
    fireEvent.change(prompt, { target: { value: "/" } });
    fireEvent.keyDown(prompt, { key: "ArrowUp" });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent("Ship");
    fireEvent.keyDown(prompt, { key: "ArrowDown" });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent("Implement");
    fireEvent.keyDown(prompt, { key: "Enter", isComposing: true });
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(select).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(prompt).toHaveValue(buildSlashCommands({})[0]!.insertText);
  });

  it("closes from the touch control and ignores slashes in prose or multiline prompts", () => {
    render(<Prompt />);
    const prompt = screen.getByLabelText("Prompt");
    const toggle = screen.getByRole("button", { name: "/ Commands" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close commands" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(prompt).toHaveFocus();
    for (const value of ["Inspect /src", "/review\nmore context"]) {
      fireEvent.change(prompt, { target: { value } });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    }
    fireEvent.click(toggle);
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(5);
    fireEvent.click(toggle);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(prompt).toHaveValue("/review\nmore context");
  });
});
