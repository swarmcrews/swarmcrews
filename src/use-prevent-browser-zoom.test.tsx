/** Browser zoom belongs to reading/forms; only the spatial viewport consumes it. */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { isCanvasZoomTarget, usePreventBrowserZoom } from "./use-prevent-browser-zoom.ts";

function Probe() {
  usePreventBrowserZoom();
  return <><header data-testid="chrome">Workspace</header><div className="canvas-root" data-testid="canvas"><svg><circle data-testid="scene" /></svg><div data-scroll-capture data-testid="reading"><span>Conversation</span></div><input aria-label="Canvas name" /><div data-viewport-overlay data-testid="overlay">Settings</div></div></>;
}

function zoom(target: EventTarget, modifier: "ctrlKey" | "metaKey" = "ctrlKey") {
  const event = new WheelEvent("wheel", { [modifier]: true, deltaY: 12, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("usePreventBrowserZoom", () => {
  it.each(["ctrlKey", "metaKey"] as const)("preserves %s browser zoom on chrome, forms and reading surfaces", (modifier) => {
    const view = render(<Probe />);
    for (const target of [document.body, view.getByTestId("chrome"), view.getByTestId("reading").firstElementChild!, view.getByRole("textbox"), view.getByTestId("overlay")]) {
      expect(zoom(target, modifier).defaultPrevented).toBe(false);
      expect(isCanvasZoomTarget(target)).toBe(false);
    }
    view.unmount();
  });

  it.each(["ctrlKey", "metaKey"] as const)("reserves %s-wheel on canvas background and SVG for spatial zoom without stopping propagation", (modifier) => {
    const view = render(<Probe />);
    const handler = vi.fn();
    view.getByTestId("canvas").addEventListener("wheel", handler);
    for (const target of [view.getByTestId("canvas"), view.getByTestId("scene")]) {
      expect(zoom(target, modifier).defaultPrevented).toBe(true);
      expect(isCanvasZoomTarget(target)).toBe(true);
    }
    expect(handler).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("preserves ordinary wheel scrolling on canvas and chrome", () => {
    const view = render(<Probe />);
    for (const target of [document.body, view.getByTestId("canvas")]) {
      const event = new WheelEvent("wheel", { deltaY: 12, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    view.unmount();
  });

  it("removes its listener on unmount and handles non-element targets", () => {
    const view = render(<Probe />);
    const canvas = view.getByTestId("canvas");
    view.unmount();
    document.body.appendChild(canvas);
    expect(zoom(canvas).defaultPrevented).toBe(false);
    expect(isCanvasZoomTarget(document)).toBe(false);
    expect(isCanvasZoomTarget(null)).toBe(false);
    canvas.remove();
  });
});
