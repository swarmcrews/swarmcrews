import { afterEach, describe, expect, it, vi } from "vitest";
import { createBus } from "./bus.ts";
import { initDb } from "./db.ts";
import { SessionHost } from "./session-host.ts";
import { bootstrapWorkItemRuntime } from "./work-item-bootstrap.ts";
import { drainQueuedWorkItemGuidance, queueWorkItemGuidance } from "./work-item-continuation.ts";

afterEach(() => vi.restoreAllMocks());

describe("queued work-item guidance failures", () => {
  it.each(["synchronous", "asynchronous"])("contains a %s callback failure", async (mode) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = new SessionHost("run-1", "/repo");
    host.workItemId = "work-1";
    host.status = "idle";
    const fail = () => { throw new Error("continuation failed"); };
    queueWorkItemGuidance(host, mode === "synchronous" ? fail : async () => fail());

    expect(drainQueuedWorkItemGuidance(host, {} as never)).toBe(true);
    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(
      "[server:work-item-continuation] queued_guidance_failed",
      expect.objectContaining({ sessionKey: host.id, workItemId: "work-1",
        error: expect.objectContaining({ message: "continuation failed" }) }),
    ));
    expect(host.status).toBe("idle");
    expect(drainQueuedWorkItemGuidance(host, {} as never)).toBe(false);
  });

  it("keeps a failed queued relaunch scoped to its successor run", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = initDb(":memory:");
    try {
      const hosts = new Map<string, SessionHost>();
      let tick = 10;
      let launches = 0;
      const runtime = bootstrapWorkItemRuntime({
        db, bus: createBus({ clients: new Set() } as never),
        registry: { get: (key) => hosts.get(key) }, now: () => tick++,
        launch: async (options) => {
          if (++launches === 2) throw new Error("successor launch failed");
          const host = new SessionHost(options.sessionKey, options.cwd);
          host.workItemId = options.workItemId ?? null;
          host.status = "running";
          hosts.set(host.id, host);
        },
      });
      const created = await runtime.workItems.create({ requestId: "create",
        projectId: "project", projectPath: "/repo", title: "Queued follow-up", changeMode: "live" });
      const started = await runtime.workItems.startRun({ requestId: "start",
        workItemId: created.workItem.id, prompt: "Start",
        expectedLifecycleRevision: 0, expectedCurrentRunKey: null });
      const host = hosts.get(started.workItem.currentRunKey!)!;
      await runtime.workItems.continue({ requestId: "follow-up",
        workItemId: created.workItem.id, prompt: "Follow up",
        expectedLifecycleRevision: started.workItem.lifecycle.lifecycleRevision,
        expectedCurrentRunKey: host.id });
      expect(drainQueuedWorkItemGuidance(host, {} as never)).toBe(false);
      expect(launches).toBe(1);

      runtime.runtimeLifecycle.runTerminal({ workItemId: created.workItem.id,
        runKey: host.id, runKind: "primary", parentRunKey: null, taskId: null, outcome: "completed",
        finalReportId: null, finalReport: "Original run completed", at: tick++ });
      host.status = "idle";
      expect(drainQueuedWorkItemGuidance(host, {} as never)).toBe(true);
      await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(
        "[server:work-item-continuation] queued_guidance_failed",
        expect.objectContaining({ workItemId: created.workItem.id,
          error: expect.objectContaining({ message: "Run launch failed: successor launch failed" }) }),
      ));

      const failed = runtime.workItems.getSync(created.workItem.id)!;
      expect(failed.workItem.lifecycle).toMatchObject({ runtimeState: "inactive", outcome: "error" });
      expect(failed.currentRun).toMatchObject({ outcome: "error", finalReport: "successor launch failed" });
      expect(failed.workItem.currentRunKey).not.toBe(host.id);
      expect(db.prepare("SELECT run_outcome FROM sessions WHERE session_key = ?").get(host.id))
        .toEqual({ run_outcome: "completed" });
      expect(drainQueuedWorkItemGuidance(host, {} as never)).toBe(false);

      // A failed follow-up must leave the service usable for another user request.
      const retried = await runtime.workItems.continue({ requestId: "retry",
        workItemId: created.workItem.id, prompt: "Try again",
        expectedLifecycleRevision: failed.workItem.lifecycle.lifecycleRevision,
        expectedCurrentRunKey: failed.workItem.currentRunKey });
      expect(retried.workItem.lifecycle.outcome).toBe("none");
      expect(retried.workItem.currentRunKey).not.toBe(failed.workItem.currentRunKey);
      expect(launches).toBe(3);
    } finally {
      db.close();
    }
  });
});
