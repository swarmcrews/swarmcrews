import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSettings } from "./project-store.ts";
import "./harness/register-production.ts";
import { launchSession, SessionLaunchError } from "./session-launch.ts";
import type { SessionRegistry } from "./session-registry.ts";
import type { SessionCapacityReservation } from "./session-registry.ts";
import type { Bus } from "./bus.ts";
import type { HarnessReadinessSnapshot } from "./harness/readiness-types.ts";

vi.mock("./project-store.ts", () => ({ readSettings: vi.fn() }));
beforeEach(() => vi.mocked(readSettings).mockReset().mockReturnValue({
  defaultLeaderHarness: "codex", defaultLeaderModel: "gpt-5.6-sol",
}));

function snapshot(readyHarnesses: string[]): HarnessReadinessSnapshot {
  return { schemaVersion: 1, checkedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:30.000Z", ready: readyHarnesses.length > 0, readyHarnesses, harnesses: [] };
}

function setup() {
  const starts: unknown[] = [];
  const events: unknown[] = [];
  const registry = {
    has: () => false,
    reserveCapacity: (sessionKey: string): SessionCapacityReservation => ({ sessionKey, token: null }),
    releaseCapacity: vi.fn(),
    start: (options: unknown) => starts.push(options),
  } as unknown as SessionRegistry;
  const bus = { emitToSession: (_key: string, event: unknown) => events.push(event) } as unknown as Bus;
  return { registry, bus, starts, events };
}

describe("launchSession", () => {
  it("allows readiness to reuse its cache when launching", async () => {
    const h = setup();
    const getReadiness = vi.fn(async () => snapshot(["codex"]));
    await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "cached", cwd: "/work", prompt: "start", role: "leader" }, getReadiness });
    expect(getReadiness).toHaveBeenCalledWith();
  });
  it("uses the configured leader default when a draft starts without launch options", async () => {
    const h = setup();
    const result = await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "draft", cwd: "/work", prompt: "start", role: "leader" },
      getReadiness: async () => snapshot(["claude", "codex"]),
    });
    expect(result).toMatchObject({ harness: "codex", model: "gpt-5.6-sol", reasons: [] });
    expect(readSettings).toHaveBeenCalledWith("/work");
  });

  it("infers the harness from an explicit model before applying project defaults", async () => {
    vi.mocked(readSettings).mockReturnValue({ defaultLeaderHarness: "claude", defaultLeaderModel: "opus" });
    const h = setup();
    const result = await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "model-only", cwd: "/work", prompt: "start", role: "leader", initialModel: "gpt-5.6-terra" },
      getReadiness: async () => snapshot(["claude", "codex"]),
    });
    expect(result).toMatchObject({ harness: "codex", model: "gpt-5.6-terra" });
  });

  it("uses a ready configured leader default when the requested harness is unavailable", async () => {
    const h = setup();
    const result = await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "fallback", cwd: "/work", prompt: "start", role: "leader", harness: "unavailable" },
      getReadiness: async () => snapshot(["claude", "codex"]),
    });
    expect(result).toMatchObject({ harness: "codex", model: "gpt-5.6-sol", reasons: ["harness_not_ready"] });
  });

  it("preserves an explicit harness and model over the project defaults", async () => {
    const h = setup();
    const result = await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "explicit", cwd: "/work", prompt: "start", role: "leader", harness: "codex", initialModel: "gpt-5.6-terra" },
      getReadiness: async () => snapshot(["claude", "codex"]),
    });
    expect(result).toMatchObject({ harness: "codex", model: "gpt-5.6-terra" });
  });

  it("replaces a cross-provider model with the configured compatible default", async () => {
    const h = setup();
    const result = await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "mixed", cwd: "/work", prompt: "start", role: "leader", harness: "codex", initialModel: "opus" },
      getReadiness: async () => snapshot(["claude", "codex"]),
    });
    expect(result).toMatchObject({ harness: "codex", model: "gpt-5.6-sol", reasons: ["model_incompatible"] });
  });

  it.each([undefined, "pi"])("rejects an unavailable default instead of choosing another ready harness (requested: %s)", async (harness) => {
    const h = setup();
    await expect(launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "unavailable-default", cwd: "/work", prompt: "start", role: "leader", harness },
      getReadiness: async () => snapshot(["claude"]),
    })).rejects.toMatchObject({ code: "HARNESS_NOT_READY" });
    expect(h.starts).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.registry.releaseCapacity).toHaveBeenCalledOnce();
  });

  it.each(["leader", "minion"] as const)("uses the built-in %s default when no project override exists", async (role) => {
    vi.mocked(readSettings).mockReturnValue({});
    const h = setup();
    const result = await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "built-in-default", cwd: "/work", prompt: "start", role, harness: "pi" },
      getReadiness: async () => snapshot(["claude", "codex"]),
    });
    expect(result.harness).toBe(role === "leader" ? "codex" : "claude");
  });

  it("leaves minion model routing independent of the leader default", async () => {
    const h = setup();
    const result = await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "child", cwd: "/work", prompt: "start", role: "minion", harness: "codex" },
      executorClass: "mechanical", getReadiness: async () => snapshot(["codex"]),
    });
    expect(result).toMatchObject({ harness: "codex", model: "gpt-5.6-luna" });
    expect(readSettings).toHaveBeenCalledWith("/work");
  });

  it("uses configured Minion defaults for graph children with no explicit model", async () => {
    const thinkingConfig = { enabled: true, effort: "medium" as const, display: "summarized" as const };
    vi.mocked(readSettings).mockReturnValue({ defaultLeaderHarness: "claude", defaultLeaderModel: "opus",
      defaultMinionHarness: "codex", defaultMinionModel: "gpt-5.6-sol",
      adaptiveMinionModelRouting: false, defaultMinionThinkingConfig: thinkingConfig });
    const h = setup();
    const result = await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "graph-child", cwd: "/work", prompt: "implement", role: "minion" },
      executorClass: "reasoning", getReadiness: async () => snapshot(["claude", "codex"]),
    });
    expect(result).toMatchObject({ harness: "codex", model: "gpt-5.6-sol", reasons: [] });
    expect(h.starts[0]).toMatchObject({ initialModel: "gpt-5.6-sol", thinkingConfig });
  });

  it("honors adaptive Minion routing while preserving explicit launch overrides", async () => {
    vi.mocked(readSettings).mockReturnValue({ defaultMinionHarness: "codex", defaultMinionModel: "gpt-5.6-sol",
      adaptiveMinionModelRouting: true, reasoningMinionModel: "gpt-5.6-terra",
      defaultMinionThinkingConfig: { enabled: true, effort: "medium", display: "summarized" } });
    const h = setup();
    const options = { sessionKey: "adaptive", cwd: "/work", prompt: "implement", role: "minion" as const };
    expect(await launchSession({ registry: h.registry, bus: h.bus, options,
      executorClass: "reasoning", getReadiness: async () => snapshot(["codex"]) })).toMatchObject({ model: "gpt-5.6-terra" });
    const thinkingConfig = { enabled: true, effort: "low" as const, display: "summarized" as const };
    expect(await launchSession({ registry: h.registry, bus: h.bus,
      options: { ...options, initialModel: "gpt-5.6-luna", thinkingConfig },
      executorClass: "reasoning", getReadiness: async () => snapshot(["codex"]) })).toMatchObject({ model: "gpt-5.6-luna" });
    expect(h.starts[1]).toMatchObject({ thinkingConfig });
  });

  it("reads Minion defaults from the source project when the child executes in a worktree", async () => {
    vi.mocked(readSettings).mockImplementation((projectPath) => projectPath === "/source"
      ? { defaultMinionHarness: "codex", defaultMinionModel: "gpt-5.6-sol" }
      : { defaultMinionModel: "gpt-5.6-terra" });
    const h = setup();
    const result = await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "worktree-child", cwd: "/worktree", prompt: "inspect", role: "minion",
        parentWorktree: { projectPath: "/source", path: "/worktree", branch: "task" } as NonNullable<import("./session-host.ts").StartSessionOptions["parentWorktree"]> },
      getReadiness: async () => snapshot(["codex"]),
    });
    expect(readSettings).toHaveBeenCalledWith("/source");
    expect(result).toMatchObject({ harness: "codex", model: "gpt-5.6-sol" });
    expect(h.starts[0]).toMatchObject({ cwd: "/worktree" });
  });

  it("rejects an unavailable Minion default instead of falling back to the leader provider", async () => {
    vi.mocked(readSettings).mockReturnValue({ defaultMinionHarness: "copilot", defaultMinionModel: "grok-4.6" });
    const h = setup();
    await expect(launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "fallback-child", cwd: "/work", prompt: "inspect", role: "minion" },
      getReadiness: async () => snapshot(["codex"]),
    })).rejects.toMatchObject({ code: "HARNESS_NOT_READY" });
    expect(h.starts).toEqual([]);
  });

  it("falls back to the configured Minion default independently of the leader default", async () => {
    vi.mocked(readSettings).mockReturnValue({ defaultLeaderHarness: "claude",
      defaultMinionHarness: "codex", defaultMinionModel: "gpt-5.6-sol" });
    const h = setup();
    expect(await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "fallback-child", cwd: "/work", prompt: "inspect", role: "minion", harness: "pi" },
      getReadiness: async () => snapshot(["claude", "codex"]),
    })).toMatchObject({ harness: "codex", model: "gpt-5.6-sol", reasons: ["harness_not_ready", "model_incompatible"] });
  });

  it("keeps an existing host's selection without resolving new defaults", async () => {
    const h = setup();
    Object.assign(h.registry, { has: () => true,
      get: () => ({ harnessName: "codex", model: "gpt-5.6-terra", permissionMode: "auto" }) });
    const getReadiness = vi.fn();
    const result = await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "existing", cwd: "/work", prompt: "continue", role: "leader" }, getReadiness });
    expect(result).toMatchObject({ harness: "codex", model: "gpt-5.6-terra" });
    expect(readSettings).not.toHaveBeenCalled();
    expect(getReadiness).not.toHaveBeenCalled();
  });

  it("uses the prepared history handoff when readiness forces a provider switch", async () => {
    const h = setup();
    await launchSession({ registry: h.registry, bus: h.bus,
      options: { sessionKey: "next", cwd: "/work", prompt: "Continue", role: "leader", harness: "claude",
        resumeId: "claude-history", freshThreadPrompt: "PRESERVED_CONTEXT\nContinue" },
      getReadiness: vi.fn(async () => snapshot(["codex"])),
    });
    expect(h.starts[0]).toMatchObject({ harness: "codex", resumeId: undefined, prompt: "PRESERVED_CONTEXT\nContinue" });
  });

  it("switches an unavailable harness without carrying its model", async () => {
    const h = setup();
    const result = await launchSession({
      registry: h.registry, bus: h.bus,
      options: { sessionKey: "s1", cwd: "/work", prompt: "hello", role: "leader", harness: "claude", initialModel: "claude-opus-4-8", permissionMode: "plan" },
      getReadiness: vi.fn(async () => snapshot(["codex"])),
    });
    expect(result).toMatchObject({ harness: "codex", model: "gpt-5.6-sol", permissionMode: "plan", reasons: ["harness_not_ready", "model_incompatible"] });
    expect(h.events[0]).toMatchObject({ type: "session_launch_resolved", transient: true });
    expect(h.starts[0]).toMatchObject({ harness: "codex", initialModel: "gpt-5.6-sol", permissionMode: "plan" });
  });

  it("rejects before creating a host when no harness is ready", async () => {
    const h = setup();
    await expect(launchSession({ registry: h.registry, bus: h.bus, options: { sessionKey: "s1", cwd: "/work", prompt: "hello" }, getReadiness: vi.fn(async () => snapshot([])) })).rejects.toBeInstanceOf(SessionLaunchError);
    expect(h.starts).toEqual([]);
  });

  it("holds a capacity reservation across asynchronous readiness", async () => {
    let releaseReadiness!: () => void;
    const readinessGate = new Promise<void>((resolve) => { releaseReadiness = resolve; });
    const reservations = new Set<symbol>();
    const registry = {
      has: () => false,
      reserveCapacity: (sessionKey: string): SessionCapacityReservation => {
        if (reservations.size >= 1) {
          throw new Error("capacity exhausted");
        }
        const token = Symbol(sessionKey);
        reservations.add(token);
        return { sessionKey, token };
      },
      releaseCapacity: (reservation: SessionCapacityReservation) => {
        if (reservation.token) reservations.delete(reservation.token);
      },
      start: (_options: unknown, reservation: SessionCapacityReservation) => {
        if (reservation.token) reservations.delete(reservation.token);
      },
    } as unknown as SessionRegistry;
    const bus = { emitToSession: vi.fn() } as unknown as Bus;
    const first = launchSession({
      registry,
      bus,
      options: { sessionKey: "s1", cwd: "/work", prompt: "hello" },
      getReadiness: vi.fn(async () => {
        await readinessGate;
        return snapshot(["codex"]);
      }),
    });

    expect(reservations.size).toBe(1);
    await expect(launchSession({
      registry,
      bus,
      options: { sessionKey: "s2", cwd: "/work", prompt: "hello" },
      getReadiness: vi.fn(async () => snapshot(["claude"])),
    })).rejects.toThrow("capacity exhausted");

    releaseReadiness();
    await first;
    expect(reservations.size).toBe(0);
  });
});
