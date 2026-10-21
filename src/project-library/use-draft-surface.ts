import { useCallback, useRef, useState } from "react";
import { hasNavigationDraft } from "../navigation-drafts.tsx";
/** Capture explicit local draft ownership before leaving; only a real draft justifies background mounting. */
export function useDraftSurface<T extends string>(setView: (view: T) => void) {
  const root = useRef<HTMLDivElement>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const changeView = useCallback((view: T) => { setHasDraft(hasNavigationDraft(root.current)); setView(view); }, [setView]);
  return { root, hasDraft, changeView };
}
