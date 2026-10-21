import { forgetProjectLeaderDrafts } from "../nodes/leader/prompt/leader-drafts.ts";
import { hasNavigationDraft, openNavigationDraft } from "../navigation-drafts.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { getLibrary } from "./api.ts";
import { projectDestination, rememberDestination } from "./model.ts";
export interface OpenProject { id: string; path: string; acknowledgement?: string }
function routeUrl(project: OpenProject | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete("project"); url.searchParams.delete("workItem"); url.searchParams.delete("surface");
  if (project) {
    url.searchParams.set("project", project.id);
    const destination = projectDestination(project.id);
    url.searchParams.set("surface", destination.view);
    if (destination.workItemId) url.searchParams.set("workItem", destination.workItemId);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
export function useProjectNavigation() {
  const [project, setProject] = useState<OpenProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const guard = useRef<(() => boolean) | null>(null);
  const request = useRef(0);
  const current = useRef(project); current.current = project;
  const registerGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const clearBlocked = useCallback(() => { pending.current = null; setBlocked(false); }, []);
  const confirmNavigation = useCallback(() => {
    const proceed = pending.current;
    clearBlocked();
    // A draft confirmation must not bypass failed/in-flight project saves.
    if (!guard.current || guard.current()) proceed?.();
  }, [clearBlocked]);
  const openDraft = useCallback(() => { clearBlocked(); openNavigationDraft(); }, [clearBlocked]);
  const deferForDraft = useCallback((proceed: () => void) => {
    if (!hasNavigationDraft(document)) return false;
    pending.current = proceed; setBlocked(true); return true;
  }, []);
  const navigate = useCallback((next: OpenProject | null) => {
    request.current += 1;
    const proceed = (confirmed = false) => {
      if (confirmed && current.current && current.current.id !== next?.id) forgetProjectLeaderDrafts(current.current.id);
      request.current += 1; clearBlocked();
      window.history.pushState({}, "", routeUrl(next)); setError(null); setProject(next);
    };
    if (deferForDraft(() => proceed(true))) return;
    if (guard.current && !guard.current()) return;
    proceed();
  }, [clearBlocked, deferForDraft]);
  useEffect(() => {
    let stopped = false;
    const resolve = async (target = window.location.href, confirmed = false) => {
      const serial = ++request.current;
      const canLeave = () => {
        if ((!confirmed && deferForDraft(() => void resolve(target, true))) || (guard.current && !guard.current())) {
          window.history.replaceState({}, "", routeUrl(current.current)); return false;
        }
        return true;
      };
      if (!canLeave()) return;
      const url = new URL(target); const id = url.searchParams.get("project");
      const commit = (next: OpenProject | null, message: string | null = null) => {
        if (confirmed && current.current && current.current.id !== next?.id) forgetProjectLeaderDrafts(current.current.id);
        clearBlocked(); window.history.replaceState({}, "", target); setProject(next); setError(message);
      };
      if (!id) { commit(null); return; }
      try {
        const library = await getLibrary(); if (stopped || serial !== request.current || !canLeave()) return;
        const selected = library.projects.find(p => p.id === id && !p.archived);
        if (!selected) { commit(null, "This project is unavailable or archived. Choose a Library project or restore it explicitly."); return; }
        const surface = url.searchParams.get("surface"); const workItemId = url.searchParams.get("workItem");
        if (surface === "activity" || surface === "canvas" || surface === "context") rememberDestination(id, { view: surface, ...(workItemId ? { workItemId } : {}) });
        commit({ id, path: selected.path });
      } catch (err) { if (!stopped && serial === request.current && canLeave()) commit(null, `Couldn’t resolve project. ${err instanceof Error ? err.message : "Retry from Library."}`); }
    };
    if (new URL(window.location.href).searchParams.has("project")) void resolve();
    const pop = () => void resolve(); window.addEventListener("popstate", pop);
    return () => { stopped = true; window.removeEventListener("popstate", pop); };
  }, [clearBlocked, deferForDraft]);
  return { project, navigate, error, registerGuard, blocked, clearBlocked, confirmNavigation, openDraft };
}
