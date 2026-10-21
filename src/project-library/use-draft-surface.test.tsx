import { LeaderPromptBar } from "../nodes/leader/prompt/LeaderPromptBar.tsx";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useDraftSurface } from "./use-draft-surface.ts";
function Surface() {
  const [input, setInput] = useState("");
  const [view,setView]=useState("canvas"); const draft=useDraftSurface(setView);
  return <><button onClick={()=>draft.changeView(view==="canvas"?"activity":"canvas")}>Switch surface</button>{(view==="canvas"||draft.hasDraft)&&<div ref={draft.root} hidden={view!=="canvas"}><LeaderPromptBar input={input} onInputChange={setInput} onKeyDown={() => {}} onSubmit={() => {}} placeholder="Canvas prompt" ariaLabel="Canvas prompt" submitLabel="Start" disabled={false} active /></div>}</>;
}
it("unmounts quiet Canvas but keeps a populated local prompt across Activity and back",()=>{
  render(<Surface/>);
  fireEvent.click(screen.getByRole("button",{name:"Switch surface"}));
  expect(screen.queryByLabelText("Canvas prompt")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Switch surface"}));
  fireEvent.change(screen.getByLabelText("Canvas prompt"),{target:{value:"Unsaved leader instructions"}});
  fireEvent.click(screen.getByRole("button",{name:"Switch surface"}));
  expect(screen.getByLabelText("Canvas prompt")).toHaveValue("Unsaved leader instructions");
  expect(screen.getByLabelText("Canvas prompt")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Switch surface"}));
  expect(screen.getByLabelText("Canvas prompt")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Canvas prompt"),{target:{value:""}});
  fireEvent.click(screen.getByRole("button",{name:"Switch surface"}));
  expect(screen.queryByLabelText("Canvas prompt")).not.toBeInTheDocument();
});
