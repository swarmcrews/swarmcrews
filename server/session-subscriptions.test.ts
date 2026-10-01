import { describe, expect, it } from "vitest";
import { MAX_EXPLICIT_SESSION_SUBSCRIPTIONS, connectionAccepts, indexProjectEvent, indexSessionProjects, setConnectionProject, subscribeConnectionSession } from "./session-subscriptions.ts";

function client(): import("ws").WebSocket { return {} as import("ws").WebSocket; }
describe("scoped subscription routing", () => {
  it("does not erase prior project mappings when a scoped snapshot is indexed", () => {
    const ws = client(); setConnectionProject(ws, "a");
    indexSessionProjects([{ sessionKey: "a-run", projectId: "a", workItemId: "a-item" }]);
    indexSessionProjects([{ sessionKey: "b-run", projectId: "b", workItemId: "b-item" }]);
    expect(connectionAccepts(ws, "session:a-run")).toBe(true);
    expect(connectionAccepts(ws, "session:b-run")).toBe(false);
    expect(connectionAccepts(ws, "work-item:a-item")).toBe(true);
    expect(connectionAccepts(ws, "work-item:b-item")).toBe(false);
  });
  it("learns new canonical runs from scoped work-item events without another inventory", () => {
    const ws = client(); setConnectionProject(ws, "a");
    indexProjectEvent("a", { type: "work_item_run_created", workItemId: "fresh-item", run: { runKey: "fresh-run" } });
    expect(connectionAccepts(ws, "session:fresh-run")).toBe(true);
    expect(connectionAccepts(ws, "work-item:fresh-item")).toBe(true);
  });
  it("drops visited session subscriptions on project switch, retaining explicit deep links only until switch", () => {
    const ws = client(); setConnectionProject(ws, "a");
    subscribeConnectionSession(ws, "deep-link");
    expect(connectionAccepts(ws, "session:deep-link")).toBe(true);
    setConnectionProject(ws, "b");
    expect(connectionAccepts(ws, "session:deep-link")).toBe(false);
  });
});

it("bounds explicit deep-link subscriptions and clears all project routing on exit", () => {
  const ws = client(); setConnectionProject(ws, "a");
  for (let i = 0; i <= MAX_EXPLICIT_SESSION_SUBSCRIPTIONS; i++) subscribeConnectionSession(ws, `visit-${i}`);
  expect(connectionAccepts(ws, "session:visit-0")).toBe(false);
  expect(connectionAccepts(ws, `session:visit-${MAX_EXPLICIT_SESSION_SUBSCRIPTIONS}`)).toBe(true);
  indexSessionProjects([{ sessionKey: "exit-run", projectId: "a" }]);
  expect(connectionAccepts(ws, "session:exit-run")).toBe(true);
  setConnectionProject(ws, null);
  expect(connectionAccepts(ws, "session:exit-run")).toBe(false);
  expect(connectionAccepts(ws, `session:visit-${MAX_EXPLICIT_SESSION_SUBSCRIPTIONS}`)).toBe(false);
  expect(connectionAccepts(ws, "global")).toBe(true);
});
