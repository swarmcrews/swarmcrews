import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectList } from "./ProjectList.tsx";
import { clearAuthToken } from "./api.ts";

let summary: unknown;
let polls = 0;

beforeEach(() => {
  vi.useFakeTimers();
  clearAuthToken();
  polls = 0;
  summary = [{ projectId: "p", activeLeaders: 2, activeCrew: 3 }];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    const url = String(input);
    let body: unknown;
    switch (url) {
      case "/api/auth/token": body = { token: "test-token" }; break;
      case "/api/projects": body = [{
        id: "p", workspaceId: "p", name: "Alpha", path: "/repo/alpha",
        lastOpened: "2026-01-01", hasSidecar: true,
      }]; break;
      case "/api/readiness": body = { ready: true, readyHarnesses: ["codex"], harnesses: [] }; break;
      case "/api/projects/activity-summary":
        expect(options?.method).toBe("POST");
        expect(JSON.parse(options?.body as string)).toEqual({ projectIds: ["p"] });
        polls++;
        body = summary;
        break;
      default: throw new Error(`Unexpected fetch: ${url}`);
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});

afterEach(() => {
  cleanup();
  clearAuthToken();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const refresh = () => act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

describe("project page periodic activity HTTP data", () => {
  it("renders and refreshes both counters through the real API client and polling component", async () => {
    await act(async () => { render(<ProjectList onOpenProject={vi.fn()} />); });
    expect(polls).toBe(1);
    expect(screen.getByText("2 active leaders")).toBeVisible();
    expect(screen.getByText("3 crew")).toBeVisible();

    summary = [{ projectId: "p", activeLeaders: 0, activeCrew: 1 }];
    await refresh();
    expect(polls).toBe(2);
    expect(screen.getByText("0 active leaders")).toBeVisible();
    expect(screen.getByText("1 crew")).toBeVisible();
    expect(screen.getByRole("img", { name: "Alpha has 0 active leaders and 1 crew" }))
      .toHaveClass("project-list-recent__activity--active");

    summary = [{ projectId: "p", activeLeaders: 0, activeCrew: 0 }];
    await refresh();
    expect(screen.getByText("0 crew")).toBeVisible();
    expect(screen.getByRole("img", { name: "Alpha is sleeping with no active sessions" })).toBeVisible();
  });

  it("does not turn a stale server payload into zeroes and recovers on a later poll", async () => {
    summary = [{ projectId: "p", activeSessions: 4 }];
    await act(async () => { render(<ProjectList onOpenProject={vi.fn()} />); });
    expect(screen.getByText("Activity unavailable")).toBeVisible();
    expect(screen.queryByText("0 active leaders")).not.toBeInTheDocument();
    expect(screen.queryByText("0 crew")).not.toBeInTheDocument();

    summary = [{ projectId: "p", activeLeaders: 1, activeCrew: 2 }];
    await refresh();
    expect(screen.getByText("1 active leader")).toBeVisible();
    expect(screen.getByText("2 crew")).toBeVisible();

    summary = [{ projectId: "p", activeLeaders: 1 }];
    await refresh();
    expect(screen.getByText("1 active leader")).toBeVisible();
    expect(screen.getByText("2 crew")).toBeVisible();
  });
});
