import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyCanvasState } from "./EmptyCanvasState.tsx";

const validDescription = "Coordinate the next product improvements.";

function renderEmptyCanvasState(description = validDescription) {
  const onDescriptionChange = vi.fn();
  const onStart = vi.fn();
  const onAddLeader = vi.fn();
  render(
    <EmptyCanvasState
      description={description}
      onDescriptionChange={onDescriptionChange}
      onStart={onStart}
      onAddLeader={onAddLeader}
    />,
  );
  return { onDescriptionChange, onStart, onAddLeader };
}

describe("EmptyCanvasState", () => {
  it("starts the Leader immediately with trimmed context from the primary action", () => {
    const { onStart, onAddLeader } = renderEmptyCanvasState(`  ${validDescription}  `);

    const start = screen.getByRole("button", { name: "Start Leader" });
    start.focus();
    expect(start).toHaveFocus();
    expect(screen.getByText(/Start Leader immediately with this context/i)).toBeVisible();

    fireEvent.click(start);

    expect(onStart).toHaveBeenCalledWith(validDescription);
    expect(onAddLeader).not.toHaveBeenCalled();
  });

  it("adds an unstarted Leader node for configuration from the secondary action", () => {
    const { onStart, onAddLeader } = renderEmptyCanvasState();

    const configure = screen.getByRole("button", { name: "Add Leader node" });
    configure.focus();
    expect(configure).toHaveFocus();
    expect(screen.getByText(/unstarted Leader node to configure advanced settings before it starts/i)).toBeVisible();

    fireEvent.click(configure);

    expect(onAddLeader).toHaveBeenCalledOnce();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("keeps the immediate action a keyboard-submit button and preserves validation", () => {
    const { onStart } = renderEmptyCanvasState("too short");

    const start = screen.getByRole("button", { name: "Start Leader" });
    expect(start).toHaveAttribute("type", "submit");
    expect(start).toBeDisabled();

    fireEvent.submit(screen.getByRole("form", { name: "Start canvas with context" }));

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Add a bit more context before starting.");
  });
});
