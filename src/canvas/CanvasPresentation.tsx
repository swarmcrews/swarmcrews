import {
  createContext, createElement, useContext, useLayoutEffect, useRef, useState,
  type ComponentType, type ReactNode,
} from "react";

/** Presentation only. Session subscriptions/recovery must stay outside this gate. */
export const CanvasPresentationContext = createContext(true);

// One observer per canvas viewport, not per card/message/editor. Explicitly
// use the canvas as root: its overflow clip would cancel a browser-root margin.
// No synchronous geometry/layout reads during startup.
const viewports = new Map<Element | null, {
  observer: IntersectionObserver;
  pending: Map<Element, Set<() => void>>;
}>();
function observeCard(card: Element, hydrate: () => void): () => void {
  const root = card.closest(".canvas-root");
  let viewport = viewports.get(root);
  if (!viewport) {
    const pending = new Map<Element, Set<() => void>>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const notify of pending.get(entry.target) ?? []) notify();
      }
    }, { root, rootMargin: "400px" });
    viewport = { observer, pending };
    viewports.set(root, viewport);
  }
  const { observer, pending } = viewport;
  let listeners = pending.get(card);
  if (!listeners) {
    listeners = new Set();
    pending.set(card, listeners);
    observer.observe(card);
  }
  listeners.add(hydrate);
  return () => {
    listeners.delete(hydrate);
    if (listeners.size === 0) {
      pending.delete(card);
      observer.unobserve(card);
    }
    if (pending.size === 0) {
      observer.disconnect();
      viewports.delete(root);
    }
  };
}

/**
 * Keep node runtimes mounted immediately, but hydrate expensive visual children
 * only when the card approaches the viewport (or is explicitly selected).
 * Hydration is one-way: parking/panning never discards drafts or local UI state.
 * Outside canvas cards, including Activity/mobile, presentation stays eager.
 */
export function CanvasPresentationProvider({ selected, children }: {
  selected: boolean;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [hydrated, setHydrated] = useState(() => typeof IntersectionObserver === "undefined");
  useLayoutEffect(() => {
    if (hydrated) return;
    const card = anchor.current?.closest(".canvas-node-card");
    if (selected || !card) { setHydrated(true); return; }
    return observeCard(card, () => setHydrated(true));
  }, [hydrated, selected]);
  return <CanvasPresentationContext.Provider value={hydrated || selected}>
    <span ref={anchor} hidden aria-hidden="true" />
    {children}
  </CanvasPresentationContext.Provider>;
}

/** Opt in only pure presentation surfaces, never a node's runtime renderer. */
export function deferCanvasPresentation<P extends object>(Surface: ComponentType<P>): ComponentType<P> {
  return function DeferredCanvasPresentation(props: P) {
    return useContext(CanvasPresentationContext) ? createElement(Surface, props) : null;
  };
}
