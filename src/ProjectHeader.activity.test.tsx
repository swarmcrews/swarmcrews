import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHeader } from "./ProjectHeader.tsx";
import { clearAuthToken } from "./api.ts";
import type { ProjectActivitySummary } from "../shared/project-activity.ts";

const projects = [
  { id: "alpha", name: "Alpha", path: "/repo/alpha", lastOpened: "2026-01-01", hasSidecar: true },
  { id: "beta", workspaceId: "beta-workspace", name: "Beta", path: "/repo/beta", lastOpened: "2026-01-01", hasSidecar: true },
  { id: "gamma", name: "Gamma", path: "/repo/gamma", lastOpened: "2026-01-01", hasSidecar: true },
];
let listedProjects = projects;
let summary: ProjectActivitySummary[];
let requests: RequestInit[];
let respond: () => Promise<Response>;
const json = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  vi.useFakeTimers();
  clearAuthToken();
  listedProjects = projects;
  summary = [
    { projectId: "beta-workspace", activeLeaders: 2, activeCrew: 3 },
    { projectId: "gamma", activeLeaders: 0, activeCrew: 0 },
  ];
  requests = [];
  respond = async () => json(summary);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    switch (String(input)) {
      case "/api/auth/token": return json({ token: "test" });
      case "/api/projects/library": return json({ projects: listedProjects.map(project => ({
        ...project, id: project.workspaceId ?? project.id, workspaceId: project.workspaceId ?? project.id,
        sourceRoot: project.path, displayName: null, description: "", tags: [], collectionIds: [],
        archived: false, focusOrder: null, revision: 0, createdAt: "2026-01-01T00:00:00.000Z",
      })), collections: [], focusRevision: 0 });
      case "/api/projects/activity-summary":
        requests.push(options!);
        return respond();
      default: throw new Error(`Unexpected request: ${String(input)}`);
    }
  });
});
afterEach(() => {
  cleanup();
  clearAuthToken();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mount() {
  const props = {
    projectId: "alpha", name: "Alpha", saveStatus: "idle" as const, lastSaved: null,
    onRename: vi.fn(), onBack: vi.fn(), onSwitchProject: vi.fn(), activeView: "activity" as const,
    onViewChange: vi.fn(), settings: {}, onSettingsChange: vi.fn(), socketSend: vi.fn(),
    sessions: [{ sessionKey: "local", sessionId: null, projectId: "alpha", cwd: "/repo/alpha",
      role: "leader" as const, status: "running", taskName: "Local work" }],
  };
  const view = render(<ProjectHeader {...props} />);
  await act(async () => {});
  return { ...view, props };
}
const toggle = () => act(async () => { fireEvent.click(screen.getByRole("button", { name: "Alpha" })); });
const advance = (ms = 5_000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const beta = () => within(screen.getByRole("menuitemradio", { name: /Beta/ }));

describe("project switcher counts-only activity", () => {
  it("requests only other project counts on demand, retaining the current project's live preview", async () => {
    const { props } = await mount();
    await advance();
    expect(requests).toHaveLength(0);
    await toggle();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(JSON.parse(requests[0]?.body as string)).toEqual({ projectIds: ["beta-workspace", "gamma"] });
    expect(beta().getByText("2 active leaders")).toBeVisible();
    expect(beta().getByText("3 crew")).toBeVisible();
    const alpha = within(screen.getByRole("menuitemradio", { name: /Alpha/ }));
    expect(alpha.getByText("1 active leader")).toBeVisible();
    expect(alpha.getByText("Local work")).toBeVisible();
    expect(props.socketSend).not.toHaveBeenCalled();

    summary = [{ projectId: "beta-workspace", activeLeaders: 0, activeCrew: 1 }];
    await advance();
    expect(requests).toHaveLength(2);
    expect(beta().getByText("0 active leaders")).toBeVisible();
    expect(beta().getByText("1 crew")).toBeVisible();
    summary = [{ projectId: "beta-workspace", activeLeaders: 0, activeCrew: 0 }];
    await advance();
    expect(beta().queryByText(/crew$/)).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/projects/library")).toHaveLength(1);

    await toggle();
    expect(requests.at(-1)?.signal?.aborted).toBe(true);
    await advance(20_000);
    expect(requests).toHaveLength(3);
    await toggle();
    expect(requests).toHaveLength(4); // one refresh, not an old-list + new-list request
    expect(new Set(vi.mocked(fetch).mock.calls.map(([url]) => url))).toEqual(new Set([
      "/api/auth/token", "/api/projects/library", "/api/projects/activity-summary",
    ]));
  });

  it("does not poll a single-project switcher", async () => {
    listedProjects = [projects[0]!];
    await mount();
    await toggle();
    await advance(20_000);
    expect(requests).toHaveLength(0);
    expect(screen.getByText("Local work")).toBeVisible();
  });

  it("pauses in hidden tabs and coalesces focus/visibility refreshes", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await mount();
    await toggle();
    await advance(20_000);
    expect(requests).toHaveLength(0);
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(requests).toHaveLength(1);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(requests).toHaveLength(1);
    await advance();
    expect(requests).toHaveLength(2);
    visibility.mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await advance(20_000);
    expect(requests).toHaveLength(2);
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(requests).toHaveLength(3);
  });

  it("never overlaps slow requests and ignores a response after closing", async () => {
    let resolve!: (response: Response) => void;
    respond = () => new Promise((done) => { resolve = done; });
    await mount();
    await toggle();
    await advance(20_000);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(requests).toHaveLength(1);
    await toggle();
    expect(requests[0]?.signal?.aborted).toBe(true);
    await act(async () => { resolve(json(summary)); });
    await advance(20_000);
    expect(requests).toHaveLength(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not invent zero counts when the first summary is unavailable", async () => {
    respond = async () => json([{ projectId: "beta-workspace", activeSessions: 4 }]);
    await mount();
    await toggle();
    expect(requests).toHaveLength(1);
    expect(beta().queryByText(/active leader|crew$/)).not.toBeInTheDocument();
    respond = async () => json(summary);
    await advance();
    expect(beta().getByText("2 active leaders")).toBeVisible();
    expect(beta().getByText("3 crew")).toBeVisible();
  });

  it("preserves last-known counts on errors and recovers on the next refresh", async () => {
    await mount();
    await toggle();
    respond = async () => { throw new Error("offline"); };
    await advance();
    expect(beta().getByText("2 active leaders")).toBeVisible();
    expect(beta().getByText("3 crew")).toBeVisible();
    respond = async () => json([{ projectId: "beta-workspace", activeLeaders: 1, activeCrew: 4 }]);
    await advance();
    expect(beta().getByText("1 active leader")).toBeVisible();
    expect(beta().getByText("4 crew")).toBeVisible();
  });
});
