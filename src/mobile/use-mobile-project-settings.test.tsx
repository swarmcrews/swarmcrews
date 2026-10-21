import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMobileProjectSettings } from "./use-mobile-project-settings.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => vi.unstubAllGlobals());

describe("mobile settings request fencing", () => {
  it("ignores a previous project's late load", async () => {
    const oldLoad = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((url: unknown) => String(url).includes("/old/")
      ? oldLoad.promise : Promise.resolve(Response.json({ systemModel: "enforced" }))));
    const { result, rerender } = renderHook(({ id }) => useMobileProjectSettings(id), { initialProps: { id: "old" } });
    rerender({ id: "new" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => oldLoad.resolve(Response.json({ systemModel: "off" })));
    expect(result.current.settings.systemModel).toBe("enforced");
  });

  it("finishes authorized writes in their original project without publishing old errors in a new project", async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn((url: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") return pending.promise;
      return Promise.resolve(Response.json(String(url).includes("/new/") ? { tidyLayout: true } : {}));
    });
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(({ id }) => useMobileProjectSettings(id), { initialProps: { id: "old" } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.save({ tidyLayout: false }));
    await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1));
    act(() => result.current.save({ tidyLayout: false, snapWhileDragging: false }));
    rerender({ id: "new" });
    await waitFor(() => expect(result.current.settings).toEqual({ tidyLayout: true }));
    await act(async () => pending.reject(new Error("Old project failed")));
    expect(result.current.saveState.status).toBe("idle");
    const saves = fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(saves).toHaveLength(2);
    expect(saves.every(([url]) => String(url).includes("/old/"))).toBe(true);
  });

  it("finishes queued edits after leaving the settings screen", async () => {
    const pending = deferred<Response>();
    const writes: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => {
      if (init?.method !== "PUT") return Promise.resolve(Response.json({}));
      writes.push(init);
      return writes.length === 1 ? pending.promise : Promise.resolve(Response.json({}));
    }));
    const { result, unmount } = renderHook(() => useMobileProjectSettings("proj"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.save({ tidyLayout: false }));
    await waitFor(() => expect(writes).toHaveLength(1));
    act(() => result.current.save({ tidyLayout: false, snapWhileDragging: false }));
    unmount();
    await act(async () => pending.resolve(Response.json({})));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(JSON.parse(String(writes[1]!.body))).toMatchObject({ tidyLayout: false, snapWhileDragging: false });
  });
});
