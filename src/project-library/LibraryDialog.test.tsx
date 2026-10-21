import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LibraryDialog } from "./LibraryDialog.tsx";
import { ProjectCard } from "./ProjectCard.tsx";
import { libraryProject, summary } from "./test-fixture.ts";
afterEach(()=>vi.restoreAllMocks());
it("traps Tab at both ends, excludes disabled organization controls, closes on Escape and restores opener focus",()=>{
  const opener=document.createElement("button"); document.body.append(opener); opener.focus(); const onClose=vi.fn();
  const view=render(<LibraryDialog title={"Long project "+"X".repeat(300)} onClose={onClose}><input aria-label="Editable"/><fieldset disabled><button>Disabled organization</button></fieldset><button>Last action</button></LibraryDialog>);
  const first=screen.getByRole("button",{name:"Close"}); const last=screen.getByRole("button",{name:"Last action"});
  expect(first).toHaveFocus();
  fireEvent.keyDown(first,{key:"Tab",shiftKey:true}); expect(last).toHaveFocus();
  fireEvent.keyDown(last,{key:"Tab"}); expect(first).toHaveFocus();
  fireEvent.keyDown(first,{key:"Escape"}); expect(onClose).toHaveBeenCalledOnce();
  view.unmount(); expect(opener).toHaveFocus(); expect(opener).not.toHaveAttribute("inert"); opener.remove();
});
it("blocks dismissal while a write is pending",()=>{
  const close=vi.fn(); render(<LibraryDialog title="Saving" onClose={close} busy><input aria-label="Draft"/></LibraryDialog>);
  fireEvent.keyDown(screen.getByRole("dialog"),{key:"Escape"});
  expect(screen.getByRole("button",{name:"Close"})).toBeDisabled(); expect(close).not.toHaveBeenCalled();
});
it("keeps long identity and path disclosure without per-card unknown or empty messages",()=>{
  const name="x".repeat(200), path="/repo/"+"z".repeat(600); const project=libraryProject({name,path});
  const onOpen=vi.fn(),onDetails=vi.fn(),onUpdates=vi.fn(),onActivity=vi.fn();
  const view=render(<ProjectCard project={project} now={Date.now()} onOpen={onOpen} onDetails={onDetails} onActivity={onActivity} onUpdates={onUpdates}/>);
  expect(screen.getByRole("button",{name:`Open ${name}`})).toHaveTextContent(name);
  expect(screen.getByRole("button",{name:`Open ${name}`})).toHaveAttribute("title",path);
  expect(view.container.querySelector(".pl-state, .pl-recent-row, footer")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:`Open ${name}`})); expect(onOpen).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button",{name:`Details and organization for ${name}`})); expect(onDetails).toHaveBeenCalledOnce();
  view.rerender(<ProjectCard project={project} summary={summary()} now={Date.now()} onOpen={onOpen} onDetails={onDetails} onActivity={onActivity} onUpdates={onUpdates}/>);
  expect(view.container.querySelector(".pl-state, .pl-recent-row, footer")).toBeNull();
  expect(onActivity).not.toHaveBeenCalled();
});
