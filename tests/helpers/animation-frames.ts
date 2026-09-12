import { act } from "@testing-library/react";
import { beforeEach, afterEach, vi } from "vitest";

/** Advance one browser frame without also running debounce or camera timers. */
export function mockAnimationFrames() {
  let callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  let time = 0;
  beforeEach(() => {
    callbacks = new Map();
    nextId = 0;
    time = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => {
      callbacks.set(++nextId, callback);
      return nextId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(id => { callbacks.delete(id); });
  });
  afterEach(() => {
    vi.mocked(requestAnimationFrame).mockRestore();
    vi.mocked(cancelAnimationFrame).mockRestore();
  });
  return () => act(() => {
    time += 16;
    const frame = [...callbacks.values()];
    callbacks.clear();
    frame.forEach(callback => callback(time));
  });
}
