import { useLayoutEffect, useRef, type RefObject } from "react";

/** Float in the conversation viewport; fullscreen follows visible selected chunks. */
export function useSelectionToolbarPosition(
  containerRef: RefObject<HTMLDivElement | null>,
  active: boolean,
  selectedIds: ReadonlySet<string>,
  content: string,
) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const toolbar = toolbarRef.current;
    const controls = controlsRef.current;
    const feed = container?.closest<HTMLElement>("[data-selection-viewport]");
    if (!active || !container || !toolbar || !controls || !feed) return;

    const chunks = Array.from(container.querySelectorAll<HTMLElement>("[data-chunk-id]"));
    const selected = chunks.filter(chunk => selectedIds.has(chunk.dataset["chunkId"]!));
    // Keep the mode controls reachable after clearing the selection, too.
    const bounds = selected.length ? selected : chunks;
    const first = bounds[0];
    const last = bounds.at(-1);
    if (!first || !last) return;

    const update = () => {
      const slot = toolbar.getBoundingClientRect();
      if (!toolbar.offsetHeight || !slot.height) return;
      // Canvas zoom scales client rectangles; CSS translations use local pixels.
      const scale = slot.height / toolbar.offsetHeight;
      const viewport = feed.getBoundingClientRect();
      const viewportTop = viewport.top + feed.clientTop * scale;
      const viewportBottom = viewportTop + feed.clientHeight * scale;
      const gap = 4 * scale;
      let top: number;
      if (feed.dataset["selectionViewport"] === "fullscreen") {
        const visible = bounds.map(chunk => chunk.getBoundingClientRect())
          .filter(rect => rect.height > 0 && rect.bottom > viewportTop && rect.top < viewportBottom);
        const lastVisible = visible.at(-1);
        // Visibility must follow actual chunks, not the span across unselected gaps.
        // Keep the reserved footer and selection intact so scrolling back restores it.
        const hidden = !lastVisible;
        if (hidden && controls.contains(document.activeElement)) feed.focus({ preventScroll: true });
        controls.style.visibility = hidden ? "hidden" : "";
        controls.toggleAttribute("inert", hidden);
        controls.setAttribute("aria-hidden", String(hidden));
        if (!lastVisible) return;
        top = Math.max(viewportTop + gap,
          Math.min(lastVisible.bottom + gap, viewportBottom - gap - slot.height));
      } else {
        // Preserve canvas placement and its zoom-scaled coordinates.
        const bottom = last.getBoundingClientRect().bottom;
        const start = Math.min(first.getBoundingClientRect().top, bottom - slot.height);
        top = Math.min(Math.max(viewportBottom - gap - slot.height, start), bottom - slot.height);
      }
      controls.style.transform = `translateY(${(top - slot.top) / scale}px)`;
    };

    update();
    feed.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    // Observe all chunks: expanding a preceding report can move the selection.
    [feed, container, toolbar, ...chunks].forEach(element => observer.observe(element));
    // Fullscreen's content wrapper also changes when a preceding message grows.
    if (container.parentElement) observer.observe(container.parentElement);
    return () => {
      feed.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
      controls.style.removeProperty("transform");
      controls.style.removeProperty("visibility");
      controls.removeAttribute("inert");
      controls.removeAttribute("aria-hidden");
    };
  }, [active, containerRef, selectedIds, content]);

  return { toolbarRef, controlsRef };
}
