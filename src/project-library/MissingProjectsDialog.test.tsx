import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MissingProjectsDialog } from "./MissingProjectsDialog.tsx";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { boundaryResponse, libraryProject } from "./test-fixture.ts";
import { clearAuthToken } from "../api.ts";
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
afterEach(() => { vi.restoreAllMocks(); clearAuthToken(); sessionStorage.clear(); });
function boundary(count = 2) {
  const projects = Array.from({ length: count }, (_, i) => libraryProject({ id: id(i), workspaceId: id(i), name: `Project ${i}`, path: `/tmp/test-${i}`, sourceRoot: `/tmp/test-${i}` }));
  const requests: Array<{ url: string; body: any }> = []; let failScan = false; let failCleanup = false; let partial = false;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    const url = String(input); const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (url === "/api/auth/token") return boundaryResponse({ token: "test" });
    expect((options?.headers as Record<string, string>)["Authorization"]).toBe("Bearer test"); requests.push({ url, body });
    if (url.endsWith("/library")) return boundaryResponse({ projects, collections: [], focusRevision: 0 });
    if (url.endsWith("/scan")) {
      if (failScan) { failScan = false; return boundaryResponse({ error: "Scan offline" }, 503); }
      return boundaryResponse(body.projectIds.filter((key: string) => !projects.find(p => p.id === key)?.archived).map((key: string) => ({ id: key, revision: 0, eligible: key !== id(1) })));
    }
    if (url.endsWith("/cleanup")) {
      if (failCleanup) { failCleanup = false; return boundaryResponse({ error: "Cleanup offline" }, 503); }
      const keys = body.projects.map((p: { id: string }) => p.id);
      if (partial) return boundaryResponse({ archived: [], skipped: keys.map((key: string) => ({ id: key, reason: "Folder is no longer confirmed missing" })) });
      for (const p of projects) if (keys.includes(p.id)) p.archived = true;
      return boundaryResponse({ archived: keys, skipped: [] });
    }
    if (url.endsWith("/summary")) return boundaryResponse([]);
    if (url.endsWith("/unread")) return boundaryResponse({ total: 0, projects: 0, asOf: 0 });
    return boundaryResponse({}, 404);
  });
  return { fetch, requests, projects, failScan: () => { failScan = true; }, failCleanup: () => { failCleanup = true; }, partial: () => { partial = true; } };
}
it("opens from Library, previews missing folders, disables unsafe choices, and only writes after confirmation", async () => {
  const b = boundary(); render(<LibraryWorkspace onOpen={vi.fn()} />);
  const tools = screen.queryByLabelText("Library tools"); if (tools) fireEvent.click(tools);
  const action = screen.getByRole("button", { name: "Clean up missing folders" }); await waitFor(() => expect(action).toBeEnabled()); fireEvent.click(action);
  const dialog = await screen.findByRole("dialog", { name: "Clean up missing folders" });
  const archive = await within(dialog).findByRole("button", { name: "Archive 1 missing project" }); await waitFor(() => expect(archive).toBeEnabled());
  expect(within(dialog).getByLabelText("Select Project 1 (/tmp/test-1)")).toBeDisabled();
  expect(dialog).toHaveTextContent("Files, workspace identity and history are preserved");
  expect(b.requests.filter(r => r.url.endsWith("/cleanup"))).toHaveLength(0);
  fireEvent.click(archive); expect(await within(dialog).findByText(/Archived 1 project\./)).toBeVisible();
  expect(b.requests.find(r => r.url.endsWith("/cleanup"))?.body).toEqual({ projects: [{ id: id(0), expectedRevision: 0 }] });
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Open Project 0" })).not.toBeInTheDocument());
});
it("scans and archives in bounded batches and paginates the review list", async () => {
  const b = boundary(103); const changed = vi.fn().mockResolvedValue(true);
  render(<MissingProjectsDialog onClose={vi.fn()} onChanged={changed} />);
  const archive = await screen.findByRole("button", { name: "Archive 102 missing projects" }); await waitFor(() => expect(archive).toBeEnabled());
  expect(screen.getAllByRole("checkbox")).toHaveLength(26);
  expect(b.requests.filter(r => r.url.endsWith("/scan")).map(r => r.body.projectIds.length)).toEqual([100, 3]);
  fireEvent.click(archive); await screen.findByText(/Archived 102 projects\./);
  expect(b.requests.filter(r => r.url.endsWith("/cleanup")).map(r => r.body.projects.length)).toEqual([100, 2]); expect(changed).toHaveBeenCalledOnce();
});
it("supports selection and cancellation without mutating projects", async () => {
  const b = boundary(); const close = vi.fn(); render(<MissingProjectsDialog onClose={close} onChanged={vi.fn()} />);
  await screen.findByRole("button", { name: "Archive 1 missing project" });
  fireEvent.click(screen.getByLabelText("Select Project 0 (/tmp/test-0)")); expect(screen.getByRole("button", { name: "Archive 0 missing projects" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(close).toHaveBeenCalledOnce();
  expect(b.requests.some(r => r.url.endsWith("/cleanup"))).toBe(false);
});
it("requires rescan after an ambiguous write failure and reports partial skips", async () => {
  const b = boundary(); b.failCleanup(); render(<MissingProjectsDialog onClose={vi.fn()} onChanged={vi.fn().mockResolvedValue(true)} />);
  fireEvent.click(await screen.findByRole("button", { name: "Archive 1 missing project" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Scan again before retrying");
  expect(screen.getByRole("button", { name: "Archive 1 missing project" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Scan again" })); b.partial();
  const archive = await screen.findByRole("button", { name: "Archive 1 missing project" }); await waitFor(() => expect(archive).toBeEnabled()); fireEvent.click(archive);
  expect(await screen.findByText(/Skipped 1/)).toBeVisible(); expect(screen.getByText("Folder is no longer confirmed missing")).toBeVisible();
});
it("keeps scan errors distinct from empty results and supports recovery", async () => {
  const b = boundary(); b.failScan();
  render(<MissingProjectsDialog onClose={vi.fn()} onChanged={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Scan offline");
  expect(screen.queryByText("No missing folders to clean up.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Archive 0 missing projects" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
  expect(await screen.findByRole("button", { name: "Archive 1 missing project" })).toBeEnabled();
});
it("shows an honest empty state", async () => {
  const b = boundary(0);
  render(<MissingProjectsDialog onClose={vi.fn()} onChanged={vi.fn()} />);
  expect(await screen.findByText("No missing folders to clean up.")).toBeVisible();
  expect(b.requests.some(r => r.url.endsWith("/cleanup"))).toBe(false);
});
