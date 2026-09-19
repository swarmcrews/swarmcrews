/** Bounded trace diagnostics: observations, not causal attribution. */
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {toolResponseMetrics} from './trace-metrics.mjs';
const dir=resolve(process.argv[2]??'');
if(!process.argv[2])throw Error('trace.mjs CELL_DIRECTORY');
const readLines=async file=>{try{return (await readFile(join(dir,file),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}};
const [events,audits]=await Promise.all([readLines('events.jsonl'),readLines('trajectory.jsonl')]);
const sessions=new Map(),totals=new Map();
for(const audit of audits)for(const session of audit.sessions){
 const previous=sessions.get(session.sessionKey);
 sessions.set(session.sessionKey,{...previous,...session,firstObservedAt:previous?.firstObservedAt??audit.at,lastObservedAt:audit.at});
}
for(const event of events)if(event.type==='usage' && event.payload.kind==='cumulative_session'){
 const p=event.payload;
 totals.set(event.participantId,{totalTokens:p.input+p.output+(p.cacheRead??0)+(p.cacheWrite??0),uncachedInput:p.input,output:p.output,coverage:p.coverage});
}
const calls=events.filter(e=>e.payload.kind==='tool_call');
const toolResponses=toolResponseMetrics(events);
const count=pattern=>calls.filter(e=>pattern.test(e.payload.name??'')).length;
const pollCalls=calls.filter(e=>/get_graph_plan|get_task_status/.test(e.payload.name??'') || /\bsleep\s+\d/.test(e.payload.input?.command??''));
const firstGraph=audits.find(a=>a.graph), firstChild=audits.find(a=>a.sessions.some(s=>s.role==='minion'));
const lastGraph=[...audits].reverse().find(a=>a.graph)?.graph;
const graphs=new Map();
for(const audit of audits)if(audit.graph?.graphRunId)graphs.set(audit.graph.graphRunId,audit.graph);
const first=audits[0]?.at;
const difference=(a,b)=>a&&b?Date.parse(a)-Date.parse(b):null;
const result={
 observation:'Timing boundaries come from periodic adapter observations and include polling uncertainty. Counts are diagnostic; they do not establish which operation caused a delay.',
 observedPlanningMs:difference(firstGraph?.at,first),observedFirstChildMs:difference(firstChild?.at,first),
 graphStatus:lastGraph?.status??null,nodeCount:lastGraph?.nodes?.length??0,
 graphRunCount:graphs.size,
 observedGraphs:[...graphs.values()].map(g=>({graphRunId:g.graphRunId,status:g.status,nodeCount:g.nodes?.length??0})),
 blockedReportCalls:count(/report_blocked/),
 graphProposals:count(/submit_graph_plan|submit_graph_document/),statusPollCalls:pollCalls.length,
 artifactStageCalls:count(/stage_output_artifact/),completionCalls:count(/complete_task/),
 toolResponses,
 sessions:[...sessions.values()].map(s=>({...s,usage:totals.get(s.sessionKey)??null})),
 nodeStates:lastGraph?.nodes?.map(n=>({id:n.id,title:n.title,state:n.logicalState,attempts:n.attemptHistory?.length??0}))??[],
};
await writeFile(join(dir,'trace-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
