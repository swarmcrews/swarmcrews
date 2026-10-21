import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { libraryBoundary, libraryProject, summary } from "./test-fixture.ts";
import { clearAuthToken } from "../api.ts";
import type { LibraryEvent } from "../../shared/project-library/index.ts";
afterEach(() => { vi.restoreAllMocks(); clearAuthToken(); sessionStorage.clear(); });
const event = (projectId: string, at: number): LibraryEvent => ({ id: `update-${projectId}`, projectId, workItemId: null, kind: "context", text: `Recorded update for ${projectId}`, at, revision: 1, unread: true, destination: { view: "context" } });

it("features only the latest three matching projects and keeps them in the complete compact list", async () => {
  const projects = Array.from({ length: 5 }, (_, i) => libraryProject({ id: `p${i}`, name: `Project ${i}`, tags: i === 0 ? ["match"] : [], lastOpened: "2020-01-01" }));
  const b = libraryBoundary({ projects });
  b.setLeaders(Object.fromEntries(projects.slice(0, 4).map((p, i) => [p.id, [{ workItemId: `work-${p.id}`, title: `Leader ${p.name}`, at: Date.now() - (i + 1) * 60000 }]])));
  b.setSummaries(projects.map((p, i) => summary({ projectId: p.id, unread: i < 4 ? 1 : 0, recent: i < 4 ? event(p.id, Date.now() - (i + 1) * 60000) : null })));
  render(<LibraryWorkspace onOpen={vi.fn()} />);
  const featured = await screen.findByRole("region", { name: "Recent conversations" });
  expect(within(featured).getAllByRole("article")).toHaveLength(3);
  expect(within(featured).getByRole("article", { name: "Recent conversations for Project 0" })).toBeVisible();
  expect(screen.getAllByRole("article").filter(row => row.classList.contains("pl-index-row"))).toHaveLength(5);
  expect(screen.queryByRole("group", { name: "Project layout" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "match" } });
  expect(within(screen.getByRole("region", { name: "Recent conversations" })).getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article", { name: "Project 0" })).toBeVisible();
  expect(screen.queryByRole("article", { name: "Project 1" })).not.toBeInTheDocument();
});

it("finds background activity beyond the first page without hydrating every project's runtime", async () => {
  const projects = Array.from({ length: 40 }, (_, i) => libraryProject({ id: `p${String(i).padStart(2, "0")}`, name: `Project ${i}`, lastOpened: "2020-01-01" }));
  const b = libraryBoundary({ projects });
  b.setLeaders({ p39: [{ workItemId: "work-p39", title: "Background leader", at: Date.now() }] });
  b.setSummaries(projects.map((p, i) => summary({ projectId: p.id, recent: i === 39 ? event(p.id, Date.now()) : null })));
  render(<LibraryWorkspace onOpen={vi.fn()} />);
  await screen.findByRole("article", { name: "Recent conversations for Project 39" });
  await waitFor(() => expect(screen.getAllByRole("article").filter(row => row.classList.contains("pl-index-row"))[0]).toHaveAccessibleName("Project 39"));
  expect(b.requests.filter(r => r.url.endsWith("/activity"))[0]!.body.projectIds).toHaveLength(40);
  expect(b.requests.filter(r => r.url.endsWith("/summary")).every(r => r.body.projectIds.length <= 27)).toBe(true);
  expect(b.requests.some(r => /sessions|transcript|\/state$/.test(r.url))).toBe(false);
});

it("opens existing update review without marking read and never renders empty highlight cards", async () => {
  const b = libraryBoundary(); const open = vi.fn(); render(<LibraryWorkspace onOpen={open} />);
  await screen.findByRole("button", { name: "Open Alpha" });
  expect(screen.queryByRole("region", { name: "Recent conversations" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open Alpha" })); expect(open).toHaveBeenCalledOnce();
  b.setSummaries([summary({ recent: event("alpha", Date.now()), unread: 1 })]);
  b.setLeaders({ alpha: [{ workItemId: "leader-alpha", title: "Actual leader", at: Date.now() }] });
  // Explicit refresh preserves the metadata/edit surface and refreshes both projections.
  fireEvent.click(screen.getByLabelText("Library tools"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh Library" }));
  const read = await screen.findByRole("button", { name: "1 new updates for Alpha from highlights" });
  fireEvent.click(read);
  await screen.findByRole("dialog");
  expect(b.requests.some(r => r.url.endsWith("/acknowledge"))).toBe(false);
});

it("opens the full project from the highlight and the exact WorkItem from a selected leader", async () => {
  const b = libraryBoundary(); const onOpen = vi.fn();
  sessionStorage.setItem("swarmcrews:project-destination:alpha", JSON.stringify({ view: "activity", workItemId: "old-selection" }));
  b.setLeaders({ alpha: [{ workItemId: "exact-leader", title: "Reviewed leader", at: Date.now() }] });
  render(<LibraryWorkspace onOpen={onOpen} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open Alpha from recent conversations" }));
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "alpha" }), { view: "activity" });
  fireEvent.click(screen.getByRole("button", { name: "Open leader session: Reviewed leader" }));
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "alpha" }), { view: "activity", workItemId: "exact-leader" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(b.requests.some(r => r.url.includes("/acknowledge"))).toBe(false);
});
