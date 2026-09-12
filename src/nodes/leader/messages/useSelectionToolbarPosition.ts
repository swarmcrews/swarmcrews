import { useLayoutEffect, useRef, type RefObject } from "react";

/** Float within the chat viewport, stopping at the selected chunk boundaries. */
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
    const feed = container?.closest<HTMLElement>(".leader-message-feed");
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
      const bottom = last.getBoundingClientRect().bottom;
      const start = Math.min(first.getBoundingClientRect().top, bottom - slot.height);
      const viewportBottom = viewport.top + (feed.clientTop + feed.clientHeight - 4) * scale;
      const top = Math.min(Math.max(viewportBottom - slot.height, start), bottom - slot.height);
      controls.style.transform = `translateY(${(top - slot.top) / scale}px)`;
    };

    update();
    feed.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    // Observe all chunks: expanding a preceding report can move the selection.
    [feed, container, toolbar, ...chunks].forEach(element => observer.observe(element));
    return () => {
      feed.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
      controls.style.removeProperty("transform");
    };
  }, [active, containerRef, selectedIds, content]);

  return { toolbarRef, controlsRef };
}
