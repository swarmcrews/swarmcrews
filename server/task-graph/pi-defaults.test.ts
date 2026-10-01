import { makeTaskGraphTempDir } from "./test-helpers.ts";
import "../harness/register-production.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { semanticTaskGraphPlanSchema } from "../../shared/task-graph-planning-contracts.ts";
import type { Bus } from "../bus.ts";
import { initDb } from "../db.ts";
import { getHarness } from "../harness/index.ts";
import { setPiModels } from "../harness/pi/models.ts";
import { resolveHarnessSandboxPolicy } from "../harness/sandbox-policy.ts";
import { writeSettings } from "../project-store.ts";
import { SessionHost } from "../session-host.ts";
import type { SessionHostDeps } from "../session-host-types.ts";
import { launchSession } from "../session-launch.ts";
import type { SessionRegistry } from "../session-registry.ts";
import { ensureWorkItemSchema } from "../work-item-schema.ts";
import { sandboxPolicyForTaskGraphNode, validateTaskGraphNodePolicy } from "./execution-policy.ts";
import { compileSemanticGraphPlan } from "./planning-compiler.ts";
import { installTaskGraphPlanningRuntime } from "./planning-runtime.ts";
import type { TaskGraphService } from "./service.ts";

const sol = "openai-codex/gpt-6-sol";
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); setPiModels([]); });

describe("Pi graph Minion defaults", () => {
  it.each(["mechanical", "standard", "reasoning"])(
    "validates and launches %s readers and writers on configured Pi/Sol", async executorClass => {
      const projectPath = makeTaskGraphTempDir();
      writeSettings(projectPath, { defaultMinionHarness: "pi", defaultMinionModel: sol,
        adaptiveMinionModelRouting: false, mechanicalMinionModel: "unused-mechanical",
        reasoningMinionModel: "unused-reasoning" });
      setPiModels([{ id: sol, label: "Sol" }]);
      const db = initDb(":memory:"); ensureWorkItemSchema(db);
      const bus = { emit: vi.fn(), emitToSession: vi.fn(), emitToProject: vi.fn(),
        emitGlobal: vi.fn(), subscribe: () => () => {} } as Bus;
      const leader = new SessionHost("primary", projectPath);
      Object.assign(leader, { role: "leader", workItemId: "work", runKind: "primary", harnessName: "pi" });
      const coordinator = installTaskGraphPlanningRuntime({ db, bus,
        registry: { get: () => leader } as unknown as SessionRegistry,
        sessionDeps: { bus } as SessionHostDeps,
        taskGraphs: { options: { db } } as unknown as TaskGraphService });
      cleanup.push(() => { coordinator.dispose(); db.close(); });
      const source = (await coordinator.options.resolveSourceAuthority("work", "primary"))!;
      expect(source.harnessName).toBe("pi");
      for (const mode of ["read", "write"]) {
        const node = compileSemanticGraphPlan({ workItemId: "work", primaryRunKey: "primary",
          workspaceId: source.workspaceId, proposalRevision: 1, defaultHarness: source.harnessName,
          defaultAllowedTools: [...source.allowedTools], validateNodePolicy: validateTaskGraphNodePolicy,
          plan: semanticTaskGraphPlanSchema.parse({ objective: "Inspect project", acceptanceCriteria: ["Done"],
            steps: [{ key: "inspect", title: "Inspect", objective: "Inspect project", acceptanceCriteria: ["Done"],
              executorClass, ownershipRequest: [{ scope: "path", mode, normalizedValue: "src" }] }] }),
        }).revision.nodes[0]!;
        expect(node.allowedHarnesses).toEqual(["pi"]);
        expect(node.allowedTools).toEqual(expect.arrayContaining(getHarness("pi").builtInTools));
        // Unmanaged is not an enforced sandbox; do not manufacture one at dispatch.
        expect(sandboxPolicyForTaskGraphNode(node)).toBeUndefined();
        const start = vi.fn();
        const result = await launchSession({ bus,
          registry: { has: () => false, reserveCapacity: (sessionKey: string) => ({ sessionKey, token: null }),
            releaseCapacity: vi.fn(), start } as unknown as SessionRegistry,
          options: { sessionKey: `child-${mode}`, cwd: projectPath, prompt: node.objective, role: "minion",
            harness: node.allowedHarnesses[0], toolAllowlist: node.allowedTools }, executorClass: node.executorClass,
          getReadiness: async () => ({ schemaVersion: 1, checkedAt: "now", expiresAt: "later",
            ready: true, readyHarnesses: ["pi", "claude"], harnesses: [] }),
        });
        expect(result).toMatchObject({ harness: "pi", model: sol, reasons: [] });
        expect(start).toHaveBeenCalledWith(expect.objectContaining({ harness: "pi", initialModel: sol }), expect.anything());
      }
      expect(resolveHarnessSandboxPolicy({ worktreeScoped: false, support: getHarness("pi").capabilities.sandboxEnforcement }))
        .toMatchObject({ effective: { filesystemScope: "unmanaged", approvalPolicy: "unmanaged" } });
    },
  );
});
