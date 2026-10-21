import { beforeEach, describe, it, expect } from "vitest";
import { createBus } from "./bus.ts";
import { SessionHost } from "./session-host.ts";
import { consumeProviderInvocation } from "./session-host-provider-loop.ts";
import { disablePersistence } from "./session-persist.ts";
import type { AgentTypeContext, AgentType } from "./agents/types.ts";
import type { NormalizedEvent } from "./harness/types.ts";

beforeEach(() => disablePersistence());
describe("host approval cleanup", () => {
  function fixture() {
    const host = new SessionHost("approval-host", "/tmp");
    host.status = "running";
    const bus = createBus({ clients: new Set() } as never);
    const request = host.toolApprovals.begin(host.abortController.signal, event => bus.emitToSession(host.id, { ...event }));
    const agentType: AgentType = { id: "default", wantsWorktree: false, buildSystemPrompt: () => undefined,
      getToolGroups: () => ({ toolGroups: {}, mcpToolNames: [] }) };
    const agentCtx = { sessionKey: host.id, runKey: host.runKey, workItemId: null, taskId: null,
      cwd: host.cwd, bus, worktreeInfo: null, worktreeIsolation: false } as AgentTypeContext;
    return { host, bus, request, agentType, agentCtx };
  }
  it.each(["completed", "error", "abort"] as const)("denies pending callbacks on native terminal %s", async reason => {
    const f = fixture();
    const pending = f.request({ tool: "shell", input: {} });
    await consumeProviderInvocation({ ...f, opts: { sessionKey: f.host.id, cwd: f.host.cwd, prompt: "test" }, deps: { bus: f.bus, startChildSession() {}, forEachLeaderTaskState() {} },
      abortController: f.host.abortController,
      events: (async function* (): AsyncGenerator<NormalizedEvent> { yield { kind: "done", reason }; })() });
    expect(await pending).toBe("deny");
    expect(f.host.toolApprovals.snapshot()).toEqual([]);
  });
  it("denies callbacks when the provider stream throws without a terminal event", async () => {
    const f = fixture();
    const pending = f.request({ tool: "shell", input: {} });
    await expect(consumeProviderInvocation({ ...f, opts: { sessionKey: f.host.id, cwd: f.host.cwd, prompt: "test" }, deps: { bus: f.bus, startChildSession() {}, forEachLeaderTaskState() {} },
      abortController: f.host.abortController,
      events: (async function* (): AsyncGenerator<NormalizedEvent> { throw new Error("stream lost"); })() })).rejects.toThrow("stream lost");
    expect(await pending).toBe("deny");
  });
  it("settles approvals before closing the provider", async () => {
    const f = fixture();
    const pending = f.request({ tool: "shell", input: {} });
    f.host.runControl = { abort() {}, async close() { expect(await pending).toBe("deny"); } };
    await f.host.terminate("close", { bus: f.bus });
    expect(f.host.toolApprovals.snapshot()).toEqual([]);
  });
});
