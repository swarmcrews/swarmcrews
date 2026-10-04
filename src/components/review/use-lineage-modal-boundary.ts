import { useLayoutEffect, useRef } from "react";

const focusable = 'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';
function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parent instanceof HTMLDetailsElement && !parent.open
      && !parent.querySelector(":scope > summary")?.contains(element)) return false;
  }
  return true;
}

/** Keep only this modal's interaction boundary; never change review authority. */
export function useLineageModalBoundary(onClose: () => void) {
  const backdrop = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const root = backdrop.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The context drawer can hide on resize while the portalled review remains open.
    const contextToggle = opener?.closest(".act-inspector")?.querySelector<HTMLElement>(".act-compact-navigation button:last-child");
    const background = [...document.body.children].filter(element => element !== root && !element.hasAttribute("inert"));
    background.forEach(element => element.setAttribute("inert", ""));
    const candidates = () => [...root.querySelectorAll<HTMLElement>(focusable)].filter(visible);
    initialFocus.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (root.closest("[inert]")) return; // A nested confirmation owns the topmost modal boundary.
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); close.current(); return;
      }
      if (event.key !== "Tab") return;
      const items = candidates(), first = items[0], last = items.at(-1);
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
      event.stopImmediatePropagation();
    };
    const focus = (event: FocusEvent) => {
      if (!root.closest("[inert]") && !root.contains(event.target as Node)) initialFocus.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("focusin", focus, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("focusin", focus, true);
      background.forEach(element => element.removeAttribute("inert"));
      const fallback = [...document.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"], button[aria-label="Open settings"]')].find(visible);
      const target = opener && visible(opener) ? opener : contextToggle && visible(contextToggle) ? contextToggle : fallback;
      target?.focus({ preventScroll: true });
    };
  }, []);
  return { backdrop, initialFocus };
}
