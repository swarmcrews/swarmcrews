import { setClaudeModels } from "../harness/claude/models.ts";
import { setCodexModels } from "../harness/codex/models.ts";
import { clearDisplayModels, rememberDisplayModels } from "../harness/catalog-discovery.ts";

import { describe, expect, it, vi } from "vitest";
import { listHarnesses } from "./list-harnesses.ts";
import { setup, cmd } from "../../tests/support/server-command-harness.ts";

const probe = vi.hoisted(() => ({
  deferred: false,
  listener: null as null | ((item: { name: string; ready: boolean; state: string }) => void),
  finish: null as null | (() => void),
  stops: 0,
  onStart: null as null | (() => void),
}));
vi.mock("../harness/readiness.ts", () => ({
  watchHarnessReadiness: (listener: typeof probe.listener) => {
    if (!probe.deferred) return { current: [], stop: () => {}, done: Promise.resolve({ harnesses: [] }) };
    probe.listener = listener;
    probe.onStart?.();
    return { current: [], stop: () => { probe.stops++; probe.listener = null; },
      done: new Promise(resolve => { probe.finish = () => resolve({ harnesses: [] }); }) };
  },
}));

// Side-effect imports register harnesses for the registry the handler reads.
import "../harness/claude/index.ts";
import "../harness/echo/index.ts";
import "../harness/codex/index.ts";
import "../harness/opencode/index.ts";
import "../harness/pi/index.ts";
import "../harness/copilot/index.ts";

describe("listHarnesses", () => {
  it("emits a global harness_list envelope including registered harness metadata", async () => {
    setClaudeModels([{ value: "native-claude", displayName: "Native Claude", description: "" }]);
    setCodexModels([{ model: "native-codex", displayName: "Native Codex" }]);
    const h = setup();
    Object.assign(h.ws, { bufferedAmount: 0, once: () => h.ws, off: () => h.ws });

    await listHarnesses(h.ctx, cmd({ type: "list_harnesses" }), h.ws);

    expect(h.wsSent).toHaveLength(1);
    const env = h.wsSent[0]!;
    expect(env["topic"]).toBe("global");
    expect(env["type"]).toBe("harness_list");
    expect(env["catalogMode"]).toBe("snapshot");

    const harnesses = env["harnesses"] as Array<{
      name: string;
      capabilities: Record<string, boolean>;
      models: Array<{ id: string; label: string }>;
      builtInTools: string[];
      account: { provider: string };
    }>;
    const byName = new Map(harnesses.map((entry) => [entry.name, entry]));

    const claude = byName.get("claude");
    expect(claude).toBeDefined();
    expect(claude!.capabilities["thinking"]).toBe(true);
    expect(claude!.capabilities["mcp"]).toBe(true);
    expect(claude!.models.length).toBeGreaterThan(0);
    expect(claude!.builtInTools).toContain("Read");
    expect(claude!.account.provider).toBe("claude");

    const codex = byName.get("codex");
    expect(codex).toBeDefined();
    expect(codex!.capabilities["thinking"]).toBe(true);
    expect(codex!.capabilities["mcp"]).toBe(true);
    expect(codex!.models).toEqual([{ id: "native-codex", label: "Native Codex (native-codex)", source: "dynamic" }]);
    expect(claude!.models).toEqual([{ id: "native-claude", label: "Native Claude (native-claude)", source: "dynamic" }]);
    setClaudeModels([]);
    setCodexModels([]);
    expect(codex!.account.provider).toBe("openai");

    const opencode = byName.get("opencode");
    expect(opencode).toBeDefined();
    expect(opencode!.capabilities["mcp"]).toBe(true);
    expect(opencode!.account.provider).toBe("opencode");

    const pi = byName.get("pi");
    expect(pi).toBeDefined();
    expect(pi!.capabilities["mcp"]).toBe(false);
    expect(pi!.capabilities["partialMessages"]).toBe(true);
    expect(pi!.account.provider).toBe("pi");

    const copilot = byName.get("copilot");
    expect(copilot).toBeDefined();
    expect(copilot!.capabilities["resume"]).toBe(true);
    expect(copilot!.account.provider).toBe("github");

    // Echo is a test-only placeholder harness and must not be exposed to the
    // client — see HIDDEN_HARNESSES in list-harnesses.ts.
    expect(byName.has("echo")).toBe(false);
  });

  it("streams fast probes before slow probes finish, coalesces duplicate requests, and cleans up on close", async () => {
    probe.deferred = true;
    try {
      const h = setup();
      let onClose: (() => void) | undefined;
      Object.assign(h.ws, { bufferedAmount: 0,
        once: (_event: string, fn: () => void) => { onClose = fn; return h.ws; },
        off: () => h.ws });
      await listHarnesses(h.ctx, cmd({ type: "list_harnesses" }), h.ws);
      await listHarnesses(h.ctx, cmd({ type: "list_harnesses" }), h.ws);
      expect(h.wsSent).toHaveLength(1);
      expect((h.wsSent[0]?.["harnesses"] as unknown[]).length).toBeGreaterThan(1);
      probe.listener?.({ name: "claude", ready: true, state: "ready" });
      expect(h.wsSent).toHaveLength(2);
      expect(h.wsSent[1]?.["catalogMode"]).toBe("patch");
      expect((h.wsSent[1]?.["harnesses"] as Array<{ name: string }>).map(item => item.name)).toEqual(["claude"]);
      onClose?.();
      probe.listener?.({ name: "pi", ready: true, state: "ready" });
      expect(h.wsSent).toHaveLength(2);
      expect(probe.stops).toBeGreaterThan(0);
      probe.finish?.();
    } finally { probe.deferred = false; }
  });

  it("captures native models before a fresh probe clears them", async () => {
    probe.deferred = true;
    setClaudeModels([{ value: "prior-native", displayName: "Prior Native", description: "" }]);
    probe.onStart = () => setClaudeModels([]);
    try {
      const h = setup();
      Object.assign(h.ws, { bufferedAmount: 0, once: () => h.ws, off: () => h.ws });
      await listHarnesses(h.ctx, cmd({ type: "list_harnesses" }), h.ws);
      const claude = (h.wsSent[0]?.["harnesses"] as Array<{ name: string; models: Array<{ id: string }> }>).find(item => item.name === "claude");
      expect(claude?.models.map(model => model.id)).toContain("prior-native");
      probe.finish?.();
    } finally { probe.deferred = false; probe.onStart = null; clearDisplayModels(); }
  });

  it("shows a bounded display cache immediately without presenting stale readiness as ready", async () => {
    probe.deferred = true;
    try {
      setClaudeModels([]);
      rememberDisplayModels("claude", [{ id: "previous-native", label: "Previous native" }]);
      const h = setup();
      Object.assign(h.ws, { bufferedAmount: 0, once: () => h.ws, off: () => h.ws });
      await listHarnesses(h.ctx, cmd({ type: "list_harnesses" }), h.ws);
      const claude = (h.wsSent[0]?.["harnesses"] as Array<{ name: string; models: Array<{ id: string }>; readiness?: { ready: boolean } }>).find(item => item.name === "claude");
      expect(claude?.models.map(model => model.id)).toContain("previous-native");
      expect(claude?.readiness).toBeUndefined();
      probe.listener?.({ name: "claude", ready: false, state: "probe_failed" });
      const failed = (h.wsSent.at(-1)?.["harnesses"] as Array<{ readiness?: { ready: boolean }; models: Array<{ id: string }> }>)[0]!;
      expect(failed.readiness?.ready).toBe(false);
      expect(failed.models.map(model => model.id)).toContain("previous-native");
      probe.finish?.();
    } finally { probe.deferred = false; clearDisplayModels(); }
  });

  it("does not require a session to be present", async () => {
    const h = setup();
    Object.assign(h.ws, { bufferedAmount: 0, once: () => h.ws, off: () => h.ws });
    // Drain the seeded session so the registry is empty.
    (h.ctx.registry as unknown as { map: Map<string, unknown> }).map.clear();

    await listHarnesses(h.ctx, cmd({ type: "list_harnesses" }), h.ws);

    expect(h.wsSent).toHaveLength(1);
    const harnesses = h.wsSent[0]!["harnesses"] as Array<{ name: string }>;
    expect(harnesses.length).toBeGreaterThan(0);
  });
});
