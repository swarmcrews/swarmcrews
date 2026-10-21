import "./test-helpers.ts";
import path from "node:path";
import { makeTaskGraphTempDir } from "./test-helpers.ts";
import { releaseDueDependencyDelays } from "./dependency-delay.ts";
import { projectTaskGraphSnapshot } from "./view.ts";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { GraphRevisionInput, SourceSnapshot, TaskNode } from "../../shared/task-graph-contracts.ts";
import { TaskGraphEvidence, TaskGraphRepository,
  TaskGraphScheduler } from "./index.ts";

const H = `sha256:${"a".repeat(64)}`;
function node(id: string, extra: Partial<TaskNode> = {}): TaskNode {
  return { id,title:id,objective:`do ${id}`,inputBindings:{},outputSchemas:{},constraints:[],acceptanceCriteria:[],
    executorClass:"standard",allowedHarnesses:["codex"],allowedTools:[],ownershipRequest:[],budgetRequest:{},
    timeoutMs:1_000,retryPolicy:{maxAttempts:2,backoffMs:10,retryableOutcomes:["failed","lost"],jitterMs:0},
    verificationRequired:false,failurePolicy:"fail_graph",expansionPolicy:null,...extra };
}
function spec(nodes: TaskNode[], edges: GraphRevisionInput["edges"] = [], max = 4): GraphRevisionInput {
  return { definitionId:"definition",revisionId:"revision",workItemId:"work",workspaceId:"workspace",objective:"mission",
    acceptanceCriteria:["done"],nonGoals:[],constraints:[],terminalNodeIds:[nodes.at(-1)!.id],nodes,edges,maxActiveAttempts:max };
}
function source(): SourceSnapshot {
  return { id:"source",workItemId:"work",primaryRunKey:"primary",taskGraphRevisionId:"revision",
    repositoryBaseCommit:"abc",dirtyDiffDigest:H,workspaceId:"workspace",worktreeIdentity:"wt",systemModelDigest:H,
    workPacketRevisionId:null,connectedContext:[],compiledSkills:[],harnessPolicyDigest:H,toolPolicyDigest:H,createdAt:1 };
}
function setup(graph = spec([node("a")]), filename = ":memory:") {
  const db = new Database(filename); db.pragma("foreign_keys=ON");
  db.exec("CREATE TABLE work_items(id TEXT PRIMARY KEY,lifecycle_revision INTEGER,current_run_key TEXT)");
  db.prepare("INSERT INTO work_items VALUES('work',7,'primary')").run();
  const repo = new TaskGraphRepository(db); repo.createRevision(graph,1);
  repo.startRun({ id:"run",workItemId:"work",primaryRunKey:"primary",revisionId:"revision",
    sourceSnapshot:source(),expectedLifecycleRevision:7,at:2 });
  return { db,repo,scheduler:new TaskGraphScheduler(repo),evidence:new TaskGraphEvidence(repo) };
}
function event(runRevision:number,attempt:{attemptId:string;generation:number},key:string,at:number,actor="actor") {
  return { runId:"run",attemptId:attempt.attemptId,generation:attempt.generation,actorSessionKey:actor,
    idempotencyKey:key,expectedRunRevision:runRevision,at };
}

const delayedEdge = (sourceNodeId = "a", extra = {}) => ({
  id:`${sourceNodeId}-b`,sourceNodeId,targetNodeId:"b",kind:"control" as const,
  sourceOutput:null,targetInput:null,satisfactionPolicy:"all_success" as const,
  failurePolicy:"block" as const,optional:false,delayMs:300_000,...extra,
});
function admit(ctx:ReturnType<typeof setup>, at:number) {
  const fencingToken=ctx.scheduler.acquireLease("run","owner",at,1_000_000);
  return ctx.scheduler.schedule({runId:"run",expectedRunRevision:ctx.repo.snapshot("run",0).run.revision,
    ownerId:"owner",fencingToken,now:at});
}
function finish(ctx:ReturnType<typeof setup>, attempt:ReturnType<typeof admit>[number], at:number,
  outcome:"succeeded"|"failed"="succeeded") {
  ctx.scheduler.terminal(event(ctx.repo.snapshot("run",0).run.revision,attempt,`done:${attempt.attemptId}`,at),outcome,{});
  ctx.evidence.evaluate("run",ctx.repo.snapshot("run",0).run.revision,at);
}

describe("durable dependency delays",()=>{
  it("starts at satisfaction, allocates nothing while waiting, and survives reopening SQLite",()=>{
    const filename=path.join(makeTaskGraphTempDir(),"graph.sqlite");
    const ctx=setup(spec([node("a"),node("b")],[delayedEdge()]),filename);
    const [a]=admit(ctx,10);
    expect(admit(ctx,300_010)).toEqual([]); // submission time is irrelevant
    finish(ctx,a!,400_000);
    expect(admit(ctx,699_999)).toEqual([]);
    const waiting=ctx.scheduler.inspect("run",699_999).find(row=>row.nodeId==="b");
    expect(waiting).toMatchObject({ready:false,reason:"dependency_delay",scheduledReleaseAt:700_000});
    const projected=projectTaskGraphSnapshot(ctx.repo.snapshot("run"),ctx.scheduler.inspect("run",699_999),699_999);
    expect(projected.nodes.find(row=>row.id==="b")).toMatchObject({
      currentAttempt:null,scheduledReleaseAt:new Date(700_000).toISOString(),blocker:{category:"delay"},
    });
    expect(ctx.repo.snapshot("run").attempts).toHaveLength(1);
    ctx.db.close();
    const db=new Database(filename);const repo=new TaskGraphRepository(db);
    const restored={db,repo,scheduler:new TaskGraphScheduler(repo),evidence:new TaskGraphEvidence(repo)};
    restored.evidence.evaluate("run",repo.snapshot("run",0).run.revision,699_999);
    expect(admit(restored,699_999)).toEqual([]);
    expect(restored.scheduler.inspect("run",700_000,false).find(row=>row.nodeId==="b")?.reason).toBe("global_capacity");
    expect(admit(restored,700_000).map(row=>row.nodeId)).toEqual(["b"]);
    expect(admit(restored,700_001)).toEqual([]);
    db.close();
  });
  it("never releases cancelled graphs",()=>{
    const ctx=setup(spec([node("a"),node("b")],[delayedEdge()]));
    finish(ctx,admit(ctx,10)[0]!,20);
    ctx.scheduler.cancelRun("run",ctx.repo.snapshot("run",0).run.revision,30);
    expect(admit(ctx,400_000)).toEqual([]);
    ctx.db.close();
  });
  it("does not bypass another unsatisfied dependency and lets independent timers overlap",()=>{
    const ctx=setup(spec([node("a"),node("c"),node("b")],[delayedEdge(),delayedEdge("c")]));
    const [a,c]=admit(ctx,10);
    finish(ctx,a!,20);
    expect(admit(ctx,400_000)).toEqual([]);
    finish(ctx,c!,400_010);
    expect(admit(ctx,700_009)).toEqual([]);
    expect(admit(ctx,700_010).map(row=>row.nodeId)).toEqual(["b"]);
    ctx.db.close();
  });
  it.each(["block","skip"] as const)("honors upstream failure policy %s",failurePolicy=>{
    const ctx=setup(spec([node("a",{failurePolicy:failurePolicy==="skip"?"continue_optional":"block_for_decision",retryPolicy:{maxAttempts:1,backoffMs:0,retryableOutcomes:[],jitterMs:0}}),node("b")],
      [delayedEdge("a",{failurePolicy})]));
    finish(ctx,admit(ctx,10)[0]!,20,"failed");
    expect(admit(ctx,300_019)).toEqual([]);
    expect(admit(ctx,300_020).map(row=>row.nodeId)).toEqual(failurePolicy==="skip"?["b"]:[]);
    ctx.db.close();
  });
  it.each(["any_success","quorum"] as const)("counts matured edges for %s joins",policy=>{
    const ctx=setup(spec([node("a"),node("c"),node("b")],
      [delayedEdge("a",{satisfactionPolicy:policy,quorum:1}),delayedEdge("c",{satisfactionPolicy:policy,quorum:1,delayMs:100})]));
    const [a,c]=admit(ctx,10);
    finish(ctx,a!,20);finish(ctx,c!,30);
    expect(admit(ctx,129)).toEqual([]);
    expect(admit(ctx,130).map(row=>row.nodeId)).toEqual(["b"]);
    ctx.db.close();
  });
  it("lets pause time elapse but still gates admission on resume and capacity",()=>{
    const ctx=setup(spec([node("a"),node("b")],[delayedEdge()]));
    finish(ctx,admit(ctx,10)[0]!,20);
    ctx.scheduler.pause("run",ctx.repo.snapshot("run",0).run.revision,true,30);
    expect(admit(ctx,300_020)).toEqual([]);
    releaseDueDependencyDelays(ctx.repo,"run",300_020);
    const revision=ctx.repo.snapshot("run",0).run.revision;
    releaseDueDependencyDelays(ctx.repo,"run",300_021);
    expect(ctx.repo.snapshot("run",0).run.revision).toBe(revision);
    expect(ctx.repo.snapshot("run").events.filter(row=>row.type==="dependency_delay_released")).toHaveLength(1);
    ctx.scheduler.pause("run",revision,false,300_022);
    expect(ctx.scheduler.inspect("run",300_022,false).find(row=>row.nodeId==="b")?.reason).toBe("global_capacity");
    expect(admit(ctx,300_023).map(row=>row.nodeId)).toEqual(["b"]);
    ctx.db.close();
  });
  it("does not delay optional dependencies or zero-duration dependencies",()=>{
    for (const edge of [delayedEdge("a",{optional:true}),delayedEdge("a",{delayMs:0})]) {
      const ctx=setup(spec([node("a"),node("b")],[edge]));
      const initial=admit(ctx,10);
      if (edge.optional) expect(initial.map(row=>row.nodeId)).toEqual(["a","b"]);
      else {
        finish(ctx,initial[0]!,20);
        expect(admit(ctx,20).map(row=>row.nodeId)).toEqual(["b"]);
      }
      ctx.db.close();
    }
  });
  it("discards invalidated evidence deadlines and starts a fresh timer for a new attempt",()=>{
    const ctx=setup(spec([node("a"),node("b")],[delayedEdge()]));
    const [a]=admit(ctx,10);finish(ctx,a!,20);
    ctx.db.prepare("INSERT INTO task_graph_steering_events VALUES('steer','run','hash','{}',30)").run();
    ctx.db.prepare("INSERT INTO task_node_invalidations VALUES('run','a','steer',?,30)").run(a!.attemptId);
    ctx.evidence.evaluate("run",ctx.repo.snapshot("run",0).run.revision,30);
    expect(ctx.db.prepare("SELECT * FROM task_edge_delays").all()).toEqual([]);
    const [retry]=admit(ctx,31);expect(retry!.nodeId).toBe("a");
    finish(ctx,retry!,40);
    expect(admit(ctx,300_020)).toEqual([]);
    expect(admit(ctx,300_040).map(row=>row.nodeId)).toEqual(["b"]);
    ctx.db.close();
  });
  it("starts artifact delays on committed evidence, not producer termination",()=>{
    const ctx=setup(spec([node("a",{outputSchemas:{result:{}}}),node("b",{inputBindings:{result:{}}})],
      [delayedEdge("a",{kind:"artifact",sourceOutput:"result",targetInput:"result"})]));
    const [a]=admit(ctx,10);
    ctx.scheduler.acknowledgeDispatch(event(1,a!,"ack",11),"actor");
    ctx.evidence.stageArtifact(event(2,a!,"stage",12),{id:"artifact",outputName:"result",schemaName:"Result",schemaVersion:"1",
      contentHash:H,storageRef:"result.json",byteSize:2,classification:"internal",retentionPolicy:"keep",observedWriteSet:[]});
    finish(ctx,a!,20);
    expect(ctx.db.prepare("SELECT * FROM task_edge_delays").all()).toEqual([]);
    ctx.evidence.commitArtifact(event(ctx.repo.snapshot("run",0).run.revision,a!,"commit",50),"artifact");
    expect(admit(ctx,300_020)).toEqual([]);
    expect(admit(ctx,300_050).map(row=>row.nodeId)).toEqual(["b"]);
    ctx.db.close();
  });

  it("delays all-terminal joins until retry policy is exhausted",()=>{
    const ctx=setup(spec([node("a",{failurePolicy:"satisfy_all_terminal_only"}),node("b")],
      [delayedEdge("a",{satisfactionPolicy:"all_terminal",failurePolicy:"skip"})]));
    const [a]=admit(ctx,10);finish(ctx,a!,20,"failed");
    expect(ctx.db.prepare("SELECT * FROM task_edge_delays").all()).toEqual([]);
    expect(admit(ctx,29)).toEqual([]);
    const [retry]=admit(ctx,30);finish(ctx,retry!,40,"failed");
    expect(admit(ctx,300_039)).toEqual([]);
    expect(admit(ctx,300_040).map(row=>row.nodeId)).toEqual(["b"]);
    ctx.db.close();
  });
  it("human-gate deadlines are anchored to input, not unrelated source completion",()=>{
    const ctx=setup(spec([node("a"),node("b")],[delayedEdge("a",{kind:"human_gate"})]));
    const [a]=admit(ctx,10);
    ctx.db.prepare("INSERT INTO task_human_inputs VALUES('input','run','b','[\"a-b\"]','user','hash','{}',20)").run();
    ctx.evidence.evaluate("run",ctx.repo.snapshot("run",0).run.revision,20);
    finish(ctx,a!,40);
    expect(admit(ctx,300_019)).toEqual([]);
    expect(admit(ctx,300_020).map(row=>row.nodeId)).toEqual(["b"]);
    ctx.db.close();
  });

});
