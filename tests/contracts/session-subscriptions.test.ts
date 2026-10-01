import { describe, expect, it } from "vitest";
import type { WebSocketServer } from "ws";
import { createBus } from "../../server/bus.ts";
import { setConnectionProject } from "../../server/session-subscriptions.ts";
import { wsEnvelopeSchema } from "../../shared/ws-envelope.ts";

function socket() {
  const sent: string[] = [];
  return { readyState: 1, sent, send(message: string) { sent.push(message); } };
}

describe("project delivery contract", () => {
  it("never puts unrelated inventory, work-item or new-run events on another project's socket", () => {
    const a = socket(), b = socket();
    setConnectionProject(a as never, "a"); setConnectionProject(b as never, "b");
    const bus = createBus({ clients: new Set([a, b]) } as unknown as WebSocketServer);
    bus.emitGlobal({ type: "session_list", sessions: [
      { sessionKey: "a-run", projectId: "a", workItemId: "a-item" },
      { sessionKey: "b-run", projectId: "b", workItemId: "b-item" },
    ] });
    bus.emitToProject("a", { type: "work_item_run_created", workItemId: "new-item",
      run: { runKey: "new-run" } });
    bus.emitToSession("new-run", { type: "session_status", sessionKey: "new-run", status: "running" });
    bus.emitToWorkItem?.("b-item", { type: "task_graph_changed", workItemId: "b-item" });
    const wireA = a.sent.map(raw => wsEnvelopeSchema.parse(JSON.parse(raw)));
    const wireB = b.sent.map(raw => wsEnvelopeSchema.parse(JSON.parse(raw)));
    expect(wireA.map(msg => msg.type)).toEqual(["session_list", "work_item_run_created", "session_status"]);
    expect(wireB.map(msg => msg.type)).toEqual(["session_list", "task_graph_changed"]);
    expect(wireA[0]?.["sessions"]).toEqual([{ sessionKey: "a-run", projectId: "a", workItemId: "a-item" }]);
    expect(wireB[0]?.["sessions"]).toEqual([{ sessionKey: "b-run", projectId: "b", workItemId: "b-item" }]);
  });
});
