import { useLayoutEffect, useRef } from "react";
import { captureTarget, locateTarget, previewText, type FeedbackState } from "./html-feedback.ts";

/** Reversible local overlays. Never mutate the published HTML or captured evidence. */
export function useHtmlFeedbackPreviews(doc: Document | null | undefined, state: FeedbackState, html: string, width: number, editing: boolean) {
  const entries = useRef(new Map<string, { element: Element; restore: () => void }>());
  const restore = () => {
    for (const entry of [...entries.current.values()].reverse()) entry.restore();
    entries.current.clear();
  };
  const apply = () => {
    if (!doc) return;
    // Resolve against the original document, before any preview changes text.
    const matches = state.items.filter(i => i.preview && state.captures.some(c => c.id === i.captureId && c.html === html))
      .map(item => ({ item, element: locateTarget(doc, item.target) }));
    for (const { item, element } of matches) {
      if (element?.isConnected) entries.current.set(item.id, { element, restore: previewText(element, item.preview!.after) });
    }
  };
  useLayoutEffect(() => { if (!editing) { restore(); apply(); } }, [doc, state.items, state.captures, html, width, editing]);
  useLayoutEffect(() => () => restore(), []);
  return {
    element: (id: string) => entries.current.get(id)?.element,
    noteId: (el: Element) => [...entries.current].find(([, entry]) => entry.element === el)?.[0],
    capture: (el: Element, w: number, h: number) => {
      const visible = captureTarget(el, w, h);
      restore();
      const original = captureTarget(el, w, h);
      apply();
      return { ...original, bounds: visible.bounds, scroll: visible.scroll };
    },
  };
}
