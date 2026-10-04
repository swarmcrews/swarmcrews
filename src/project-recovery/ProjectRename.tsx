import { useEffect, useRef, useState } from "react";
import { ProjectFeedback } from "./ProjectFeedback.tsx";
import { useProjectOperation } from "./use-project-operation.ts";

export function ProjectRename({ name, onRename, onClose }: { name: string; onRename: (name: string) => void | Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const operation = useProjectOperation();
  useEffect(() => { input.current?.select(); }, []);
  useEffect(() => { if (operation.state.status === "error") input.current?.focus(); }, [operation.state]);
  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || operation.pending) return;
    if (trimmed === name) { onClose(); return; }
    await operation.run(async () => { await onRename(trimmed); });
  };
  return <form className="project-rename" aria-label="Rename project" onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => {
    if (event.key === "Escape" && !operation.pending) { event.preventDefault(); onClose(); }
  }}>
    {operation.state.status === "success" ? <>
      <ProjectFeedback>Project renamed to “{value.trim()}”.</ProjectFeedback>
      <button type="button" autoFocus onClick={onClose}>Done</button>
    </> : <>
      <label>Project name<input ref={input} value={value} disabled={operation.pending} onChange={event => { setValue(event.target.value); operation.clear(); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }} /></label>
      <p>The saved name stays unchanged until the server confirms.</p>
      {operation.state.status === "error" && <ProjectFeedback error>Couldn’t rename project. {operation.state.error}</ProjectFeedback>}
      <div className="project-rename__actions">
        <button type="submit" disabled={operation.pending || !value.trim()}>{operation.pending ? "Saving…" : operation.state.status === "error" ? "Retry rename" : "Save name"}</button>
        <button type="button" disabled={operation.pending} onClick={onClose}>Cancel</button>
      </div>
    </>}
  </form>;
}
