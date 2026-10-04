/** Keep browser zoom for app chrome, reading surfaces and forms. */
import { useEffect } from "react";

export function isBrowserZoomWheelEvent(e: WheelEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

/** Shared with Canvas's local handler so a bubbling event is not recaptured. */
export function isCanvasZoomTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && !!target.closest(".canvas-root")
    && !target.closest('[data-scroll-capture], [data-viewport-overlay], input, textarea, select, [contenteditable="true"]');
}

export function usePreventBrowserZoom(): void {
  useEffect(() => {
    const preventBrowserZoom = (e: WheelEvent) => {
      if (isBrowserZoomWheelEvent(e) && isCanvasZoomTarget(e.target)) e.preventDefault();
    };
    document.addEventListener("wheel", preventBrowserZoom, { capture: true, passive: false });
    return () => document.removeEventListener("wheel", preventBrowserZoom, true);
  }, []);
}
