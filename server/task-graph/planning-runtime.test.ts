import "./test-helpers.ts";
import { describe, expect, it, vi } from "vitest";
import type { Bus } from "../bus.ts";
import { SessionHost } from "../session-host.ts";
import { ensureWorkItemSchema } from "../work-item-schema.ts";
import { initDb } from "../db.ts";
import type { TaskGraphPlanSnapshotView } from "../../shared/task-graph-planning-contracts.ts";
import type { SessionRegistry } from "../session-registry.ts";
import type { SessionHostDeps } from "../session-host-types.ts";
import { TaskGraphPlanningCoordinator } from "./planning-coordinator.ts";
import { installTaskGraphPlanningRuntime } from "./planning-runtime.ts";
import type { TaskGraphService } from "./service.ts";

describe("planning runtime installation", () => {
  it("delivers bounded decision evidence for the frozen treatment and ignores obsolete graph wakes", async () => {
    const db = initDb(":memory:"); ensureWorkItemSchema(db);
    db.prepare("INSERT INTO sessions(session_key,run_config_json) VALUES (?,?)").run("primary",
      JSON.stringify({ taskGraphExperiments: { decisionContinuations: true } }));
    const bus = { emit: () => {}, emitToSession: () => {}, emitToProject: () => {}, emitGlobal: () => {}, subscribe: () => () => {} } as Bus;
    const leader = new SessionHost("primary", "/tmp/work");
    leader.status = "idle"; leader.role = "leader"; leader.workItemId = "work"; leader.runKind = "primary";
    const resumeWorkItemRun = vi.fn().mockResolvedValue(undefined);
    const deps = { bus, startChildSession: vi.fn(), resumeWorkItemRun, forEachLeaderTaskState: () => {} } as unknown as SessionHostDeps;
    const coordinator = installTaskGraphPlanningRuntime({ db, bus,
      registry: { get: () => leader } as unknown as SessionRegistry, sessionDeps: deps,
      taskGraphs: { options: { db } } as unknown as TaskGraphService });
    const plan = { proposalId: "new", workItemId: "work", primaryRunKey: "primary", graphRunId: "new-graph", revision: 3,
      proposalRevision: 1, state: "completed", questions: [], acceptanceCriteria: ["Checked"], reviewRequirements: [], steps: [] } as unknown as TaskGraphPlanSnapshotView;
    vi.spyOn(coordinator.repo, "latest").mockReturnValue(plan);
    vi.spyOn(coordinator, "inspection").mockReturnValue({ plan, runtime: null, history: [] });
    vi.spyOn(coordinator, "acknowledgeTerminalWake").mockImplementation(() => {});
    coordinator.options.onTerminal?.({ ...plan, graphRunId: "old-graph" });
    coordinator.options.onAttention?.({ ...plan, revision: 2 }, "blocked", 2);
    expect(resumeWorkItemRun).not.toHaveBeenCalled();
    coordinator.options.onTerminal?.(plan);
    coordinator.options.onTerminal?.(plan);
    await vi.waitFor(() => expect(resumeWorkItemRun).toHaveBeenCalledOnce());
    const delivery = JSON.stringify(resumeWorkItemRun.mock.calls[0]);
    expect(delivery).toContain("new-graph");
    expect(delivery).toContain("bounded routing evidence");
    expect(delivery).toContain("detail");
    expect(deps.getTaskGraphExperiments?.("primary").decisionContinuations).toBe(true);
    coordinator.dispose(); db.close();
  });
  it("defers planning recovery until the caller has hydrated the session registry", () => {
    const db = initDb(":memory:");
    ensureWorkItemSchema(db);
    const bus: Bus = {
      emit: () => {}, emitToSession: () => {}, emitToProject: () => {},
      emitGlobal: () => {}, subscribe: () => () => {},
    };
    const sessionDeps = {
      bus, startChildSession: () => {}, forEachLeaderTaskState: () => {},
    } as SessionHostDeps;
    const start = vi.spyOn(TaskGraphPlanningCoordinator.prototype, "start");

    const coordinator = installTaskGraphPlanningRuntime({
      db, bus,
      registry: { get: () => null } as unknown as SessionRegistry,
      sessionDeps,
      taskGraphs: { options: { db } } as unknown as TaskGraphService,
    });

    ensureWorkItemSchema(db);
    db.prepare("INSERT INTO sessions(session_key, run_config_json) VALUES (?, ?)")
      .run("legacy-primary", JSON.stringify({ orchestrationMode: "direct" }));
    expect(sessionDeps.getLeaderOrchestrationMode?.("legacy-primary")).toBe("auto");
    expect(sessionDeps.getTaskGraphPlanning?.("legacy-primary")).toBe(coordinator);
    expect(start).not.toHaveBeenCalled();
    coordinator.start();
    expect(start).toHaveBeenCalledOnce();
    coordinator.dispose();
    start.mockRestore();
  });

  it("resumes the bound Leader once when duplicate terminal reconciliation arrives", async () => {
    const db = initDb(":memory:");
    ensureWorkItemSchema(db);
    const bus: Bus = {
      emit: () => {}, emitToSession: () => {}, emitToProject: () => {},
      emitGlobal: () => {}, subscribe: () => () => {},
    };
    const leader = new SessionHost("primary", "/tmp/work");
    leader.status = "idle";
    leader.role = "leader";
    leader.workItemId = "work";
    leader.runKind = "primary";
    leader.sessionId = "sdk-primary";
    const resumeWorkItemRun = vi.fn().mockResolvedValue(undefined);
    const sessionDeps = { bus, startChildSession: vi.fn(), resumeWorkItemRun,
      forEachLeaderTaskState: () => {} } as unknown as SessionHostDeps;
    const coordinator = installTaskGraphPlanningRuntime({ db, bus,
      registry: { get: (key:string) => key === "primary" ? leader : undefined } as unknown as SessionRegistry,
      sessionDeps, taskGraphs: { options: { db } } as unknown as TaskGraphService });
    const terminalPlan = { proposalId:"proposal",workItemId:"work",primaryRunKey:"primary",
      graphRunId:"graph",state:"completed" } as TaskGraphPlanSnapshotView;
    const acknowledge=vi.spyOn(coordinator,"acknowledgeTerminalWake");

    coordinator.options.onTerminal?.(terminalPlan);
    coordinator.options.onTerminal?.(terminalPlan);
    await vi.waitFor(() => expect(resumeWorkItemRun).toHaveBeenCalledOnce());
    expect(resumeWorkItemRun.mock.calls[0]?.[0]).toMatchObject({
      workItemId:"work",runKey:"primary",requestId:expect.stringMatching(/^wake:primary:/),
    });
    expect(acknowledge).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it("acknowledges a terminal wake only after transient dispatch failure recovers", async () => {
    vi.useFakeTimers();vi.setSystemTime(0);
    try {
      const db=initDb(":memory:"); ensureWorkItemSchema(db);
      const bus:Bus={emit:()=>{},emitToSession:()=>{},emitToProject:()=>{},emitGlobal:()=>{},
        subscribe:()=>()=>{}};
      const leader=new SessionHost("primary","/tmp/work");
      leader.status="idle";leader.role="leader";leader.workItemId="work";leader.runKind="primary";
      const resumeWorkItemRun=vi.fn().mockRejectedValueOnce(Object.assign(new Error("transient"), { code: "SQLITE_BUSY" }))
        .mockResolvedValueOnce(undefined);
      const sessionDeps={bus,startChildSession:vi.fn(),resumeWorkItemRun,
        forEachLeaderTaskState:()=>{}} as unknown as SessionHostDeps;
      const coordinator=installTaskGraphPlanningRuntime({db,bus,
        registry:{get:()=>leader} as unknown as SessionRegistry,sessionDeps,
        taskGraphs:{options:{db}} as unknown as TaskGraphService});
      const acknowledge=vi.spyOn(coordinator,"acknowledgeTerminalWake");
      const terminalPlan={proposalId:"proposal",workItemId:"work",primaryRunKey:"primary",
        graphRunId:"graph",state:"failed"} as TaskGraphPlanSnapshotView;

      coordinator.options.onTerminal?.(terminalPlan);
      await Promise.resolve();
      expect(resumeWorkItemRun).toHaveBeenCalledOnce();
      expect(acknowledge).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(16_500);
      expect(resumeWorkItemRun).toHaveBeenCalledTimes(2);
      await Promise.resolve();
      expect(acknowledge).toHaveBeenCalledOnce();
      coordinator.dispose();
    } finally { vi.useRealTimers(); }
  });

  it("delivers a dialectic synthesis report directly to the resumed Leader",async()=>{
    const db=initDb(":memory:"); ensureWorkItemSchema(db);
    const bus:Bus={emit:()=>{},emitToSession:()=>{},emitToProject:()=>{},emitGlobal:()=>{},
      subscribe:()=>()=>{}};
    const leader=new SessionHost("primary","/tmp/work");
    leader.status="idle";leader.role="leader";leader.workItemId="work";leader.runKind="primary";
    leader.sessionId="sdk-primary";
    const resumeWorkItemRun=vi.fn().mockResolvedValue(undefined);
    const sessionDeps={bus,startChildSession:vi.fn(),resumeWorkItemRun,
      forEachLeaderTaskState:()=>{}} as unknown as SessionHostDeps;
    const graph={run:{revision:12},
      revision:{nodes:[{id:"checkpoint",reasoning:{kind:"dialectic",phase:"synthesis",
        final:false}}],edges:[{id:"gate",kind:"human_gate",sourceNodeId:"checkpoint",
        targetNodeId:"next"}]},edgeEvaluations:[],artifacts:[{id:"artifact",
        node_id:"checkpoint",output_name:"synthesis",state:"committed"}]};
    const taskGraphs={options:{db},snapshot:vi.fn(()=>graph)} as unknown as TaskGraphService;
    const coordinator=installTaskGraphPlanningRuntime({db,bus,
      registry:{get:()=>leader} as unknown as SessionRegistry,sessionDeps,taskGraphs});
    vi.spyOn(coordinator,"readArtifact").mockReturnValue({content:JSON.stringify({
      goalDistance:0.4,recommendation:"reshape",unresolvedQuestions:["cost"]})});
    const plan={proposalId:"proposal",workItemId:"work",primaryRunKey:"primary",
      graphRunId:"graph",state:"running"} as TaskGraphPlanSnapshotView;

    coordinator.options.onAttention?.(plan,"blocked",12);

    await vi.waitFor(()=>expect(resumeWorkItemRun).toHaveBeenCalledOnce());
    expect(resumeWorkItemRun.mock.calls[0]?.[0]).toMatchObject({prompt:expect.stringMatching(
      /goalDistance.*0\.4[\s\S]*moderate_dialectic/)});
    coordinator.dispose();
  });
});
