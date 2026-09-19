import {readFile,readdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const median = xs => { const a=[...xs].sort((a,b)=>a-b); return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2 : null; };
function signP(wins,n) {
 let term=2**(-n),p=0;
 for(let k=0;k<=n;k++){if(k>=wins)p+=term;term*= (n-k)/(k+1);}
 return p;
}
export function compare(baseline,candidate) {
 const issues=[];
 const key=x=>`${x.split}:${x.repetition}`;
 for(const [name,rows] of [['baseline',baseline],['candidate',candidate]]) {
  if(new Set(rows.map(key)).size!==rows.length)issues.push(`${name}: duplicate repetitions`);
  if(rows.some(x=>!x.complete || !x.passed))issues.push(`${name}: failed, missing or incomplete run`);
  if(rows.some(x=>!Number.isFinite(x.ms)||x.ms<=0||!Number.isFinite(x.tokens)||x.tokens<=0||x.coverage!=='complete'))issues.push(`${name}: incomplete timing or token coverage`);
 }
 const pairs=baseline.map(b=>[b,candidate.find(c=>key(c)===key(b))]);
 if(!baseline.length||baseline.length!==candidate.length||pairs.some(([,c])=>!c))issues.push('unmatched cohort');
 const all=[...baseline,...candidate];
 for(const field of ['runtimeHash','oracleHash','fixtureHash','protocolHash','model','effort','split']) if(new Set(all.map(x=>x[field])).size!==1 || all.some(x=>!x[field]))issues.push(`mismatched or missing ${field}`);
 const valid=pairs.filter(([b,c])=>c && b.complete && c.complete && b.passed && c.passed
   && b.coverage==='complete' && c.coverage==='complete' && b.ms>0 && c.ms>0 && b.tokens>0 && c.tokens>0
   && ['runtimeHash','oracleHash','fixtureHash','protocolHash','model','effort','split'].every(field=>b[field]&&b[field]===c[field]));
 const wallRatios=valid.map(([b,c])=>c.ms/b.ms), tokenRatios=valid.map(([b,c])=>c.tokens/b.tokens);
 const wins=wallRatios.filter(x=>x<1).length;
 const metrics={pairs:valid.length,baselinePasses:baseline.filter(x=>x.passed).length,candidatePasses:candidate.filter(x=>x.passed).length,medianWallRatio:median(wallRatios),medianTokenRatio:median(tokenRatios),wallWins:wins,oneSidedSignP:valid.length?signP(wins,valid.length):null};
 if(valid.length<5)issues.push('at least five fresh matched pairs required');
 if(metrics.medianWallRatio===null || metrics.medianWallRatio>0.85)issues.push('median wall improvement below 15%');
 if(metrics.medianTokenRatio===null || metrics.medianTokenRatio>1.25)issues.push('median token multiplier exceeds 1.25');
 if(metrics.oneSidedSignP===null || metrics.oneSidedSignP>0.05)issues.push('wall advantage not confirmed by one-sided sign test');
 return {accepted:issues.length===0,issues,metrics,scope:'Local exploratory evidence on one fixed task; no cross-task or controlled-isolation claim'};
}
export async function loadRows(root) {
 const rows=[];
 for(const name of await readdir(join(root,'runs'))) {
  const dir=join(root,'runs',name);
  const read=async n=>JSON.parse(await readFile(join(dir,n),'utf8')).valueOf();
  const optional=async n=>{try{return await read(n);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const registered=await read('registered.json');
  const [result,grade,provenance,violation,spec]=await Promise.all(['result.json','grade.json','provenance.json','treatment-violation.json','spec.json'].map(optional));
  const protocolHash=provenance?.protocolSha256 ?? (spec ? createHash('sha256').update(JSON.stringify({model:spec.configuration.model,effort:spec.configuration.reasoningEffort,limits:spec.limits,nativeDelegation:false,publicFeedback:'smoke.mjs'})).digest('hex') : undefined);
  rows.push({...registered,complete:!!result&&!!grade,passed:!violation&&result?.executionOutcome==='completed'&&grade?.length===7&&grade.every(v=>v.pass),ms:result?.timings?.executionMs??null,tokens:result?.usage?.totalTokens??null,coverage:result?.usage?.coverage??null,runtimeHash:provenance?.runtime?.appFingerprint,oracleHash:provenance?.oracleSha256,fixtureHash:provenance?.fixtureSha256,protocolHash});
 }
 return rows;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const [root,split='development',base='codex-raw:baseline',candidate='minion-graph:bounded-parallel']=process.argv.slice(2);
 if(!root)throw Error('compare.mjs ROOT [split] [baselineMode:variant] [candidateMode:variant]');
 const rows=await loadRows(resolve(root));
 const select=target=>rows.filter(r=>r.split===split&&`${r.mode}:${r.variant}`===target);
 const report={split,baseline:base,candidate,rows,...compare(select(base),select(candidate))};
 console.log(JSON.stringify(report,null,2));
 await writeFile(join(root,`comparison-${split}-${base.replace(':','-')}-${candidate.replace(':','-')}.json`),JSON.stringify(report,null,2));
 // Append, never erase failed generations or silently promote a development pilot.
 await appendFile(join(root,'decisions.jsonl'),JSON.stringify({at:new Date().toISOString(),split,baseline:base,candidate,decision:report.accepted&&split==='validation'?'eligible-for-confirmation':report.accepted&&split==='confirmation'?'confirmed-local-improvement':'not-promoted',metrics:report.metrics,reasons:report.issues})+'\n');
}
