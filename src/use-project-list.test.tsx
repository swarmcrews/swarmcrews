import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "./api.ts";
import { ProjectList } from "./ProjectList.tsx";
import { ProjectsScreen } from "./mobile/ProjectsScreen.tsx";

const project = { id: "p1", path: "/repo/alpha", name: "Alpha", lastOpened: "2026-07-10T00:00:00Z", hasSidecar: true };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

for (const surface of ["desktop", "mobile"] as const) {
  describe(`${surface} project startup recovery`, () => {
    let requests: ReturnType<typeof vi.fn<() => Promise<Response>>>;
    beforeEach(() => {
      vi.useFakeTimers();
      clearAuthToken();
      requests = vi.fn<() => Promise<Response>>().mockImplementation(() => Promise.resolve(json([])));
      vi.stubGlobal("fetch", vi.fn((url: string) => {
        if (url === "/api/auth/token") return Promise.resolve(json({ token: "test-token" }));
        if (url === "/api/projects") return requests();
        if (url.includes("activity-summary")) return Promise.resolve(json([]));
        return Promise.resolve(json({ ready: true, harnesses: [], readyHarnesses: [] }));
      }));
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      clearAuthToken();
    });
    const mount = async () => {
      let view!: ReturnType<typeof render>;
      await act(async () => {
        view = render(<StrictMode>{surface === "desktop"
          ? <ProjectList onOpenProject={() => {}} />
          : <ProjectsScreen onSelectProject={() => {}} />}</StrictMode>);
      });
      return view;
    };

    it("automatically discovers projects after an initially empty response", async () => {
      let available = false;
      requests.mockImplementation(() => Promise.resolve(json(available ? [project] : [])));
      await mount();
      available = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(screen.getByText("Alpha")).toBeVisible();
      const count = requests.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(requests).toHaveBeenCalledTimes(count);
    });

    it("recovers from a server that is unavailable on the first request", async () => {
      let available = false;
      requests.mockImplementation(() => available
        ? Promise.resolve(json([project]))
        : Promise.reject(new TypeError("Failed to fetch")));
      await mount();
      expect(screen.getByRole("alert")).toBeVisible();
      expect(screen.queryByRole("button", { name: "Start tutorial" })).not.toBeInTheDocument();
      available = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(screen.getByText("Alpha")).toBeVisible();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps pending requests out of the empty state without overlapping requests", async () => {
      let resolve!: (response: Response) => void;
      requests.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
      await mount();
      expect(screen.getByText(/Loading/)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Start tutorial" })).not.toBeInTheDocument();
      const count = requests.mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("online"));
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(requests).toHaveBeenCalledTimes(count);
      await act(async () => { resolve(json([])); });
      expect(screen.getByRole("button", { name: "Start tutorial" })).toBeVisible();
    });

    it("pauses background requests in hidden tabs and rechecks when visible", async () => {
      await mount();
      const initial = requests.mock.calls.length;
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(requests).toHaveBeenCalledTimes(initial);
      visibility.mockReturnValue("visible");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      expect(requests).toHaveBeenCalledTimes(initial + 1);
      expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(requests).toHaveBeenCalledTimes(initial + 2);
    });

    it("ignores a request that finishes after unmount", async () => {
      let resolve!: (response: Response) => void;
      requests.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
      const view = await mount();
      const initial = requests.mock.calls.length;
      view.unmount();
      await act(async () => {
        resolve(json([]));
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(requests).toHaveBeenCalledTimes(initial);
    });

    it("rechecks on reconnect and stops checking after unmount", async () => {
      requests.mockImplementation(() => Promise.resolve(json([])));
      const view = await mount();
      const initial = requests.mock.calls.length;
      await act(async () => { window.dispatchEvent(new Event("online")); });
      expect(requests).toHaveBeenCalledTimes(initial + 1);
      view.unmount();
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(requests).toHaveBeenCalledTimes(initial + 1);
    });
  });
}
