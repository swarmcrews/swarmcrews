import "./test-helpers.ts";
import "../harness/register-production.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { semanticTaskGraphPlanSchema } from "../../shared/task-graph-planning-contracts.ts";
import type { Bus } from "../bus.ts";
import { initDb } from "../db.ts";
import { getHarness } from "../harness/index.ts";
import { setCopilotModels } from "../harness/copilot/models.ts";
import { readSettings } from "../project-store.ts";
import { SessionHost } from "../session-host.ts";
import type { SessionHostDeps } from "../session-host-types.ts";
import { launchSession } from "../session-launch.ts";
import type { SessionRegistry } from "../session-registry.ts";
import { ensureWorkItemSchema } from "../work-item-schema.ts";
import { validateTaskGraphNodePolicy } from "./execution-policy.ts";
import { compileSemanticGraphPlan } from "./planning-compiler.ts";
import { installTaskGraphPlanningRuntime } from "./planning-runtime.ts";
import type { TaskGraphService } from "./service.ts";

vi.mock("../project-store.ts", async (original) => ({
  ...await original<typeof import("../project-store.ts")>(), readSettings: vi.fn(),
}));
vi.mock("../workspace-registry.ts", async (original) => ({
  ...await original<typeof import("../workspace-registry.ts")>(),
  findWorkspaceBySource: () => ({ id: "workspace" }),
}));

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); setCopilotModels([]); });
beforeEach(() => {
  vi.mocked(readSettings).mockReset().mockReturnValue({
    defaultLeaderHarness: "codex", defaultLeaderModel: "gpt-6-astra",
    defaultMinionHarness: "copilot", defaultMinionModel: "grok-4.6",
    adaptiveMinionModelRouting: false,
  });
  setCopilotModels([{ id: "grok-4.6", name: "Grok 4.6", capabilities: {
    supports: { vision: false, reasoningEffort: false },
    limits: { max_context_window_tokens: 128_000 },
  } }]);
});

async function setup(toolAllowlist: string[] | null = null) {
  const db = initDb(":memory:"); ensureWorkItemSchema(db);
  const bus = { emit: vi.fn(), emitToSession: vi.fn(), emitToProject: vi.fn(),
    emitGlobal: vi.fn(), subscribe: () => () => {} } as Bus;
  const leader = new SessionHost("primary", "/repo");
  Object.assign(leader, { role: "leader", workItemId: "work", runKind: "primary",
    harnessName: "codex", toolAllowlist });
  const coordinator = installTaskGraphPlanningRuntime({ db, bus,
    registry: { get: () => leader } as unknown as SessionRegistry,
    sessionDeps: { bus } as SessionHostDeps,
    taskGraphs: { options: { db } } as unknown as TaskGraphService });
  cleanup.push(() => { coordinator.dispose(); db.close(); });
  const source = (await coordinator.options.resolveSourceAuthority("work", "primary"))!;
  const compile = (overrides: Record<string, unknown> = {}) => compileSemanticGraphPlan({
    workItemId: "work", primaryRunKey: "primary", workspaceId: source.workspaceId,
    proposalRevision: 1, defaultHarness: source.harnessName,
    defaultAllowedTools: [...source.allowedTools],
    plan: semanticTaskGraphPlanSchema.parse({ objective: "Inspect project",
      acceptanceCriteria: ["Findings recorded"], steps: [{ key: "inspect", title: "Inspect",
        objective: "Inspect project", acceptanceCriteria: ["Findings recorded"], ...overrides }] }),
  }).revision.nodes[0]!;
  return { bus, leader, coordinator, source, compile };
}

describe("Task Graph Minion defaults", () => {
  it.each(["mechanical", "standard", "reasoning"])(
    "resolves Copilot/Grok for a Codex Leader's %s step with adaptive routing disabled", async (executorClass) => {
      const { bus, source, compile } = await setup();
      const node = compile({ executorClass });
      expect(source.harnessName).toBe("copilot");
      expect(node.allowedHarnesses).toEqual(["copilot"]);
      expect(node.allowedTools).toEqual(expect.arrayContaining(getHarness("copilot").builtInTools));
      expect(node.allowedTools).not.toContain("exec_command");
      expect(node.model).toBeUndefined();
      const start = vi.fn();
      // Exercise launch resolution without starting an external provider process.
      const result = await launchSession({ bus,
        registry: { has: () => false, reserveCapacity: (sessionKey: string) => ({ sessionKey, token: null }),
          releaseCapacity: vi.fn(), start } as unknown as SessionRegistry,
        options: { sessionKey: "child", cwd: "/repo", prompt: node.objective, role: "minion",
          harness: node.allowedHarnesses[0], toolAllowlist: node.allowedTools },
        executorClass: node.executorClass,
        getReadiness: async () => ({ schemaVersion: 1, checkedAt: "now", expiresAt: "later",
          ready: true, readyHarnesses: ["codex", "copilot"], harnesses: [] }),
      });
      expect(result).toMatchObject({ harness: "copilot", model: "grok-4.6", reasons: [] });
      expect(start).toHaveBeenCalledWith(expect.objectContaining({
        harness: "copilot", initialModel: "grok-4.6",
      }), expect.anything());
    },
  );

  it("preserves explicit step provider, model, and tool overrides", async () => {
    const { compile } = await setup();
    const node = compile({ allowedHarnesses: ["codex"], model: "gpt-5.6-terra",
      allowedTools: [...getHarness("codex").builtInTools] });
    expect(node).toMatchObject({ allowedHarnesses: ["codex"], model: "gpt-5.6-terra",
      allowedTools: [...getHarness("codex").builtInTools] });
    expect(() => validateTaskGraphNodePolicy(node)).not.toThrow();
  });

  it("preserves an explicit parent tool restriction", async () => {
    const { source, compile } = await setup(["mcp__task-manager__get_task_status"]);
    expect(source.allowedTools).toEqual(["mcp__task-manager__get_task_status"]);
    expect(compile().allowedTools).toEqual(source.allowedTools);
  });

  it("uses the Minion fallback when no provider default is configured", async () => {
    vi.mocked(readSettings).mockReturnValue({ defaultLeaderHarness: "codex" });
    const { source, compile } = await setup();
    expect(source.harnessName).toBe("claude");
    expect(compile().allowedHarnesses).toEqual(["claude"]);
  });

  it("reads provider defaults from the source project for a worktree Leader", async () => {
    const { leader, coordinator } = await setup();
    leader.cwd = "/worktree";
    leader.worktree = { projectPath: "/repo", branch: "task", path: "/worktree" } as NonNullable<SessionHost["worktree"]>;
    vi.mocked(readSettings).mockClear();
    const source = await coordinator.options.resolveSourceAuthority("work", "primary");
    expect(readSettings).toHaveBeenCalledWith("/repo");
    expect(source).toMatchObject({ harnessName: "copilot", projectPath: "/repo", cwd: "/worktree" });
  });

  it("accepts the configured Copilot provider with enforced read and write sandbox policies", async () => {
    const { compile } = await setup();
    expect(() => validateTaskGraphNodePolicy(compile())).not.toThrow();
    expect(() => validateTaskGraphNodePolicy(compile({ ownershipRequest: [
      { scope: "path", mode: "write", normalizedValue: "server" },
    ] }))).not.toThrow();
  });
});
