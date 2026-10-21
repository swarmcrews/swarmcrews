import type Database from "better-sqlite3";
import type { TaskEdge } from "../../shared/task-graph-contracts.ts";
import type { TaskGraphRepository } from "./repository.ts";
import type { NodeReadiness } from "./readiness.ts";

type Row = Record<string,unknown>;

/** Called alongside evidence evaluation, never by read-only inspection. */
export function recordDependencyDelay(db:Database.Database,runId:string,edge:TaskEdge,
  satisfied:boolean,witness:string,at:number):void {
  if (!edge.delayMs) return;
  if (!satisfied) {
    db.prepare("DELETE FROM task_edge_delays WHERE run_id=? AND edge_id=?").run(runId,edge.id);
    return;
  }
  // Repeated ticks and process restarts preserve the first deadline. A new producer
  // attempt or changed evidence must earn its own delay, even with identical bytes.
  db.prepare(`INSERT INTO task_edge_delays VALUES(?,?,?,?,?,NULL) ON CONFLICT(run_id,edge_id)
    DO UPDATE SET witness=excluded.witness,satisfied_at=excluded.satisfied_at,release_at=excluded.release_at,released_at=NULL
    WHERE task_edge_delays.witness<>excluded.witness`)
    .run(runId,edge.id,witness,at,at+edge.delayMs);
}

/** A join counts matured dependencies, not timers alone. Optional edges do not gate it. */
export function dependencyJoinReadiness(nodeId:string,edges:TaskEdge[],satisfied:Map<string,boolean>,
  releases:Map<string,number>,join:Row|undefined,now:number):NodeReadiness {
  const incoming=edges.filter(edge=>edge.targetNodeId===nodeId && !edge.optional);
  const policy=String(join?.policy??"all_success");
  const release=(edge:TaskEdge):number=>!satisfied.get(edge.id) ? Infinity
    : edge.delayMs ? releases.get(edge.id)??Infinity : 0;
  const parsed:unknown=JSON.parse(String(join?.cohort_json??"[]"));
  const cohort=Array.isArray(parsed)?[...new Set(parsed.filter((id):id is string=>typeof id==="string"))]:[];
  const times=policy==="quorum" ? cohort.map(member=>{
    const memberEdges=incoming.filter(edge=>edge.sourceNodeId===member);
    return memberEdges.length?Math.max(...memberEdges.map(release)):Infinity;
  }) : incoming.map(release);
  const required=policy==="any_success"?Math.min(1,incoming.length)
    :policy==="quorum"?Number(join?.quorum??cohort.length):incoming.length;
  const count=times.filter(at=>at<=now).length;
  if (count>=required) return {nodeId,ready:true,reason:"ready"};
  const scheduledReleaseAt=times.sort((a,b)=>a-b)[required-1];
  if (scheduledReleaseAt!==undefined && Number.isFinite(scheduledReleaseAt)) {
    return {nodeId,ready:false,reason:"dependency_delay",scheduledReleaseAt};
  }
  return {nodeId,ready:false,reason:`join_unsatisfied:${count}/${required}`};
}

/** Persist one release event so capacity-blocked projections also advance revisions. */
export function releaseDueDependencyDelays(repo:TaskGraphRepository,runId:string,at:number):void {
  repo.db.transaction(()=>{
    const run=repo.db.prepare("SELECT revision,status FROM task_graph_runs WHERE id=?").get(runId) as Row;
    if (!["active","quiescent","blocked"].includes(String(run.status))) return;
    const due=repo.db.prepare(`SELECT * FROM task_edge_delays WHERE run_id=?
      AND release_at<=? AND released_at IS NULL`).all(runId,at) as Row[];
    if (!due.length) return;
    const revision=repo.casRun(runId,Number(run.revision),{},at);
    for (const row of due) {
      repo.db.prepare("UPDATE task_edge_delays SET released_at=? WHERE run_id=? AND edge_id=?")
        .run(at,runId,row.edge_id);
      repo.db.prepare("UPDATE task_edge_evaluations SET run_revision=? WHERE run_id=? AND edge_id=?")
        .run(revision,runId,row.edge_id);
      repo.appendEvent(runId,revision,"dependency_delay_released",String(row.edge_id),
        `delay:${String(row.edge_id)}:${String(row.witness)}:${String(row.release_at)}`,
        {edgeId:row.edge_id,scheduledReleaseAt:row.release_at},at);
    }
  }).immediate();
}
