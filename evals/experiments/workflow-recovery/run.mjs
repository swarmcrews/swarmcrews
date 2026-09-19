import { experimentTreatment, isExperimentVariant } from "./treatments.mjs";
/** Local exploratory runner. Frozen runtime and fresh participant state per cell. */
import {mkdir,readFile,writeFile,cp,symlink,appendFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createExternalAdapter,WebSocketSwarmcrewsProtocolClient} from '../../dist/src/adapters/index.js';
import {LifecycleRunner,ResultStore,EventStore} from '../../dist/src/core/index.js';
import {applicationFingerprint} from '../../dist/src/adapters/fingerprint.js';
import {processExecutor} from '../../dist/src/graders/executor.js';
import {materialize,build} from '../../tasks/workflow-recovery-complex/fixture.mjs';
import {gradeFiles} from '../../ground-truth/workflow-recovery-complex/oracle.mjs';
const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const repo=resolve(packageRoot,'..');
const [rootArg,mode='codex-raw',variant='baseline',split='development',repetition='1']=process.argv.slice(2);
if(!rootArg || !['codex-raw','minion-single','minion-graph'].includes(mode) || (!['baseline','bounded-parallel','bounded-wake','bounded-durable-wait','leader-scheduler'].includes(variant) && !isExperimentVariant(variant)) || !['development','validation','confirmation'].includes(split) || !/^[1-9][0-9]*$/.test(repetition)) throw Error('run.mjs ABSOLUTE_RESULTS_ROOT [mode] [baseline|bounded-parallel|bounded-wake|bounded-durable-wait|leader-scheduler|experiments-000..111] [development|validation|confirmation] [repetition]');
const root=resolve(rootArg);
const taskGraphExperiments = experimentTreatment(variant);
const graphMinimumNodes = isExperimentVariant(variant) ? 1 : 2;
if(mode!=='minion-graph' && variant!=='baseline' && variant!=='experiments-000')throw Error('Graph policy variants require minion-graph mode');
if(root!==rootArg || root.startsWith(repo+'/'))throw Error('Use an absolute results root outside the source checkout');
const model=process.env.WORKFLOW_EVAL_MODEL ?? 'gpt-5.6-sol';
const effort='medium';
const executable=process.env.WORKFLOW_EVAL_CODEX ?? join(repo,'node_modules/.bin/codex');
const id=[split,repetition,mode,variant].join('-');
const dir=join(root,'runs',id);await mkdir(dir,{recursive:true});
// Exclusive registration: interrupted and failed attempts remain in the denominator.
await writeFile(join(dir,'registered.json'),JSON.stringify({id,mode,variant,split,repetition,model,effort,taskGraphExperiments,graphMinimumNodes,registeredAt:new Date().toISOString(),controlledMeasurement:false},null,2),{flag:'wx'});
const workspace=join(dir,'workspace');await materialize({destination:workspace});
for(const args of [['init','-q'],['add','.'],['-c','user.name=Evaluator','-c','user.email=eval@example.invalid','-c','commit.gpgSign=false','-c','core.hooksPath=/dev/null','commit','--no-verify','-qm','Public fixture baseline']]){
 const r=spawnSync('git',args,{cwd:workspace,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);
}
const app=join(root,'app');
// Prepare once, before concurrent runs. Source snapshot is never a candidate workspace.
try {await mkdir(app);
 for(const name of ['server','shared','scripts','package.json','pnpm-lock.yaml','tsconfig.json','tsconfig.node.json'])await cp(join(repo,name),join(app,name),{recursive:true});
 await symlink(join(repo,'node_modules'),join(app,'node_modules'),'dir');
 await writeFile(join(root,'runtime.json'),JSON.stringify({appFingerprint:await applicationFingerprint(app),node:process.version,executable,model,effort},null,2));
} catch(e){if(e.code!=='EEXIST')throw e;}
const runtime=JSON.parse(await readFile(join(root,'runtime.json'),'utf8'));
if(runtime.appFingerprint!==await applicationFingerprint(app)||runtime.model!==model||runtime.effort!==effort||runtime.executable!==executable)throw Error('Frozen runtime drift');
const bin=join(dir,'codex-auth');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
// Credentials only, never config/history/plugins. Auth values are not logged.
const auth=join(process.env.HOME,'.codex/auth.json');
await writeFile(bin,`#!/bin/sh\nset -eu\nif [ -n "\${CODEX_HOME:-}" ]; then\n mkdir -p "$CODEX_HOME"\n if [ ! -f "$CODEX_HOME/auth.json" ]; then cp ${quote(auth)} "$CODEX_HOME/auth.json"; chmod 600 "$CODEX_HOME/auth.json"; fi\nfi\nexec ${quote(executable)} --disable multi_agent --disable multi_agent_v2 "$@"\n`,{mode:0o700});
const register=WebSocketSwarmcrewsProtocolClient.prototype.registerWorkspace;
WebSocketSwarmcrewsProtocolClient.prototype.registerWorkspace=async function(run){
 const workspaceId=await register.call(this,run);
 await this.transport.http(`/api/projects/${encodeURIComponent(workspaceId)}/settings`,{method:'PUT',body:JSON.stringify({defaultLeaderHarness:'codex',defaultMinionHarness:'codex',defaultLeaderModel:model,defaultMinionModel:model,defaultModel:model,adaptiveMinionModelRouting:false,defaultLeaderThinkingConfig:{enabled:true,effort,display:'summarized'},defaultMinionThinkingConfig:{enabled:true,effort,display:'summarized'},systemModel:'off',taskGraphExperiments})});
 await writeFile(join(dir,'project-settings.json'),JSON.stringify(await this.transport.http(`/api/projects/${encodeURIComponent(workspaceId)}/settings`),null,2));
 this.config.pollMs=2000;return workspaceId;
};
const discover=WebSocketSwarmcrewsProtocolClient.prototype.discover;
WebSocketSwarmcrewsProtocolClient.prototype.discover=async function(saved){
 const value=await discover.call(this,saved);
 if (isExperimentVariant(variant) && mode==='minion-graph' && value.graph?.graphRunId) {
  const observed=Object.fromEntries(Object.keys(taskGraphExperiments).map(key=>[key,value.graph.taskGraphExperiments?.[key]===true]));
  if (JSON.stringify(observed)!==JSON.stringify(taskGraphExperiments)) {
   await writeFile(join(dir,'treatment-violation.json'),JSON.stringify({expected:taskGraphExperiments,observed,graphRunId:value.graph.graphRunId},null,2));
   throw Error('Frozen Task Graph experiment treatment mismatch');
  }
  await writeFile(join(dir,'experiment-treatment-audit.json'),JSON.stringify({expected:taskGraphExperiments,observed,graphRunId:value.graph.graphRunId},null,2));
 }

 const audit={sessions:value.sessions.map(s=>({sessionKey:s.sessionKey,role:s.role,model:s.model,thinkingConfig:s.thinkingConfig,status:s.status})),graph:value.graph};
 const digest=createHash('sha256').update(JSON.stringify(audit)).digest('hex');
 if(digest!==this.lastAudit){this.lastAudit=digest;await appendFile(join(dir,'trajectory.jsonl'),JSON.stringify({at:new Date().toISOString(),...audit})+'\n');}
 return value;
};
let prompt=await readFile(join(workspace,'README.md'),'utf8');
prompt+=`\nEvaluation configuration: use ${model} at ${effort} reasoning for every participant, including graph children; preserve these defaults. Do not switch models after failures.\n`;
if(['bounded-parallel','bounded-wake','bounded-durable-wait'].includes(variant))prompt+='\n\nExecution procedure: preserve the existing module exports. Use two parallel implementation nodes with disjoint ownership: (1) src/scheduler.mjs for dependency scheduling, fencing, retries and cancellation; (2) src/validation.mjs and src/storage.mjs for strict validation and persistence. Both implement the public contract and existing exports. The leader owns src/index.mjs and final integration. Put the complete public contract in each assignment; do not ask children to rediscover it. The leader may inspect the integration boundary while both nodes run. Use command verification for the public smoke after both outputs are integrated; repair concrete failures directly. Avoid additional planning, review, or summarization nodes. Child reports should identify files changed, test results and unresolved defects in at most 150 words. Stop once integrated behavior is verified.\n';
if(variant==='bounded-wake')prompt+='\nState-conditioned waiting rule: after dispatch and any independent integration-boundary inspection, if graph children are still running and no unowned work remains, end your turn with a short progress report. The server delivers a durable continuation when the graph becomes terminal or needs attention. Resume by reading get_graph_plan once and integrating the committed outputs. Do not poll with shell sleep or repeated status calls while waiting; do not schedule a second graph or mark the overall objective complete while children run.\n';
if(variant==='leader-scheduler')prompt+='\nExecution policy: use two parallel graph nodes with disjoint ownership: one owns only src/validation.mjs (strict request schemas and DAG validation); one owns only src/storage.mjs (load/save and atomic snapshot persistence). Preserve the existing exports. Supply each node its precise part of the public contract. The leader owns src/scheduler.mjs and src/index.mjs: implement scheduling, fencing, retry and cancellation directly while the two nodes run. Do not delegate a duplicate scheduler or add a reviewer node. Stored snapshots may be assumed valid as specified; do not add validation for trusted persisted snapshots or unrelated features. Children verify their own modules and report files, tests and unresolved defects in at most 150 words. Use regular-file stdio for subprocess tests, following smoke.mjs. Once the leader implementation and both children finish, run public smoke and a bounded set of integration checks, fix concrete failures, and finish. If waiting with no unowned work, end the turn for the server graph-completion wake rather than polling.\n';
if(variant==='bounded-durable-wait')prompt+='\nState-conditioned waiting rule: after dispatch and independent integration-boundary inspection, if graph children are running and no unowned work remains, call wait_and_continue with duration_seconds 600, wake_on all_terminal, and a clear reason, THEN end your turn with a short progress report. Arming the durable wait is required: ending without it closes the parent and cancels graph children. The graph terminal/attention callback resumes the leader early. On continuation inspect get_graph_plan and integrate committed outputs. Do not poll using shell sleep or repeated status calls. Do not mark the overall objective complete while children run.\n';
const settings={taskGraphExperiments,graphMinimumNodes,profile:'local-development',model,reasoningEffort:effort,stateRoot:join(dir,'adapter-state'),appRoot:app,codexExecutable:bin,executable:bin};
const config={schemaVersion:1,adapterId:mode,settings,requiredCapabilities:[]};
const adapter=createExternalAdapter(config);
const preflight=await adapter.preflight(config);
await writeFile(join(dir,'preflight.json'),JSON.stringify(preflight,null,2));
if(!preflight.supported)throw Error('Adapter preflight failed');
const limits={maxTotalTokens:2000000,executionTimeoutMs:1200000,preparationTimeoutMs:90000,gradingTimeoutMs:90000};
const spec={schemaVersion:1,runId:id,idempotencyKey:id,taskId:'workflow-recovery-complex',prompt,workspace:{id,mountPath:workspace},limits,configuration:{...settings,execution:{kind:'local',workdir:workspace,stateRoot:join(dir,'participant-state')}},visibleAssets:[]};
await writeFile(join(dir,'spec.json'),JSON.stringify(spec,null,2));
await writeFile(join(dir,'provenance.json'),JSON.stringify({runtime,taskGraphExperiments,graphMinimumNodes,treatmentVersion:1,treatmentPolicySha256:createHash('sha256').update(await readFile(join(dirname(fileURLToPath(import.meta.url)),'treatments.mjs'))).digest('hex'),protocolSha256:createHash('sha256').update(JSON.stringify({model,effort,limits,nativeDelegation:false,publicFeedback:'smoke.mjs',...(isExperimentVariant(variant)?{graphMinimumNodes}: {})})).digest('hex'),promptSha256:createHash('sha256').update(prompt).digest('hex'),fixtureSha256:createHash('sha256').update(JSON.stringify(await build())).digest('hex'),oracleSha256:createHash('sha256').update(await readFile(join(packageRoot,'ground-truth/workflow-recovery-complex/oracle.mjs'))).digest('hex'),runnerSha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')},null,2));
const store=new ResultStore(join(dir,'state.json'));
const runner=new LifecycleRunner({experimentId:'workflow-evolution',stopOnTokenLimit:true,aggregateTokenCap:2000000,store,events:new EventStore(join(dir,'events.jsonl'))},adapter);
const cell={schemaVersion:1,cellId:id,experimentId:'workflow-evolution',taskId:spec.taskId,adapterId:mode,repetition:Number(repetition),fixtureSeed:'fixed-public-v1',status:'planned'};
console.log(JSON.stringify({event:'start',id,model,effort}));
try {await runner.start({cell,spec});await runner.drive(id);}finally{await adapter.shutdown?.(id);}
const record=await store.getResult(id);
if(mode==='minion-graph') {
 const audits=(await readFile(join(dir,'trajectory.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 const mismatch=audits.flatMap(a=>a.sessions).filter(s=>s.model&&s.model!==model);
 if(mismatch.length)await writeFile(join(dir,'treatment-violation.json'),JSON.stringify({reason:'Observed model mismatch',sessions:mismatch},null,2));
}
await writeFile(join(dir,'result.json'),JSON.stringify(record,null,2));
const submission=join(dir,'submission');await mkdir(submission);
await cp(join(workspace,'src'),join(submission,'src'),{recursive:true,dereference:true});
const grade=await gradeFiles({seed:`${split}-${repetition}`,execute:processExecutor(submission,5000)});
await writeFile(join(dir,'grade.json'),JSON.stringify(grade,null,2));
console.log(JSON.stringify({event:'graded',id,outcome:record.executionOutcome,ms:record.timings.executionMs,tokens:record.usage?.totalTokens,passed:grade.filter(v=>v.pass).length,total:grade.length}));
