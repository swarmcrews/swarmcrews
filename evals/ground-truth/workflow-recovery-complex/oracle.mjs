import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
export const revision = 'r1';
export const criterionIds = ['workflow.dependencies', 'workflow.fencing', 'workflow.retry', 'workflow.cancellation', 'workflow.atomicity', 'workflow.validation', 'workflow.persistence'];

// Trusted transport: candidates execute in fresh child processes, never by import.
// Expected values remain in the controller. Each scenario owns a temporary directory.
const driver = `
import {readFileSync,existsSync,mkdirSync,rmSync,readdirSync,writeFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
const x=JSON.parse(readFileSync(0,'utf8')), file=join(x.directory,'state.json');
if(x.remove){rmSync(x.directory,{recursive:true,force:true});console.log('{}');}
else {
 mkdirSync(x.directory,{recursive:true});
 if(x.junk)writeFileSync(join(x.directory,'snapshot-abandoned.tmp'),'broken snapshot');
 const before=existsSync(file)?readFileSync(file,'utf8'):null;
 const oldStat=existsSync(file)?statSync(file,{bigint:true}):null;
 const r=spawnSync(process.execPath,['src/index.mjs'],{input:x.raw??JSON.stringify({...x.request,directory:x.directory}),encoding:'utf8',timeout:2000,maxBuffer:65536,killSignal:'SIGKILL'});
 if(r.error && !['ETIMEDOUT','ENOBUFS'].includes(r.error.code))throw r.error;
 const after=existsSync(file)?readFileSync(file,'utf8'):null;
 const newStat=existsSync(file)?statSync(file,{bigint:true}):null;
 console.log(JSON.stringify({code:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,before,after,
 unchangedFile:oldStat?.ino===newStat?.ino && oldStat?.mtimeNs===newStat?.mtimeNs,
 files:readdirSync(x.directory)}));
}`;

export async function gradeFiles({execute, seed = 'workflow-development-1'}) {
  const salt = createHash('sha256').update(String(seed)).digest('hex').slice(0, 8);
  const id = key => `${key}_${salt}`;
  const value = parseInt(salt.slice(0, 4),16) - 32768;
  const job = (key, deps = [], maxAttempts = 3) => ({id:id(key),deps:deps.map(id),value,maxAttempts});
  const claim = (now, worker = 'alice', extra = {}) => ({action:'claim',now,worker,limit:8,leaseMs:10,...extra});
  const settle = (key, attempt, now, extra = {}) => ({action:'settle',now,id:id(key),worker:'alice',token:`${id(key)}:${attempt}`,ok:true,retryMs:3,...extra});
  let launches = 0;
  async function transport(input) {
    let result;
    try { result = await execute({command:'node',args:['--input-type=module','-e',driver],stdin:JSON.stringify(input),timeoutMs:5000}); }
    catch (error) {
      if (error?.kind === 'candidate' || error?.kind === 'grader-infrastructure') throw error;
      throw Object.assign(new Error(String(error)),{kind:'grader-infrastructure'});
    }
    if (result.code !== 0) throw Object.assign(new Error(`transport failed: ${result.stderr.slice(0,200)}`),{kind:'grader-infrastructure'});
    return JSON.parse(result.stdout);
  }
  const verdicts = [];
  async function scenario(criterionId, fn) {
    const directory = `.workflow-grade-${randomUUID()}`;
    const start = launches;
    const run = async (request, options = {}) => { launches++; return transport({directory,request,...options}); };
    const ok = async request => {
      const r = await run(request);
      assert.equal(r.code,0,r.stderr); assert.equal(r.signal,null);
      assert.match(r.stdout,/^\{[^\n]*\}\n$/);
      return {output:JSON.parse(r.stdout),state:JSON.parse(r.after),...r};
    };
    const init = jobs => ok({action:'init',now:0,jobs});
    const invalid = async (request, options) => {
      const r = await run(request,options);
      assert.equal(r.code,2,`invalid request accepted: ${JSON.stringify(request)}`);
      assert.equal(r.stdout,''); assert.ok(r.stderr.trim()); assert.equal(r.after,r.before);
    };
    try {
      await fn({run,ok,init,invalid});
      verdicts.push({criterionId,pass:true,observed:`${launches-start} subprocess requests passed (${salt})`});
    } catch(error) {
      if(error?.kind==='grader-infrastructure') throw error;
      verdicts.push({criterionId,pass:false,observed:String(error).slice(0,1500)});
    } finally { await transport({directory,remove:true}); }
  }
  await scenario(criterionIds[0], async ({init,ok}) => {
    const initial = await init([job('leaf',['left','right']),job('left',['root']),job('right',['root']),job('root'),job('other')]);
    assert.deepEqual(initial.output,{ok:true});
    assert.deepEqual(initial.state,{jobs:[job('leaf',['left','right']),job('left',['root']),job('right',['root']),job('root'),job('other')].map(j=>({...j,status:'ready',attempt:0,availableAt:0,owner:null,token:null,leaseUntil:null})),effects:[]});
    assert.deepEqual((await ok(claim(0,'alice',{limit:1}))).output,{claims:[{id:id('root'),token:`${id('root')}:1`,value}]});
    await ok(settle('root',1,1));
    assert.deepEqual((await ok(claim(1))).output.claims.map(c=>c.id),['left','right','other'].map(id));
    await ok(settle('right',1,2));
    assert.deepEqual((await ok(claim(2))).output,{claims:[]});
    await ok(settle('left',1,3));
    assert.deepEqual((await ok(claim(3))).output.claims.map(c=>c.id),[id('leaf')]);
    await ok(settle('leaf',1,4));
    assert.deepEqual((await ok({action:'inspect',now:4})).state.effects,['root','right','left','leaf'].map(k=>({jobId:id(k),value})));
  });
  await scenario(criterionIds[1], async ({init,ok}) => {
    await init([job('root')]); await ok(claim(0));
    for(const r of [settle('root',1,1,{worker:'bob'}),settle('root',2,1),settle('root',1,10)]) {
      const out=await ok(r); assert.deepEqual(out.output,{accepted:false}); assert.equal(out.after,out.before);
    }
    assert.deepEqual((await ok(claim(9,'bob'))).output,{claims:[]});
    assert.deepEqual((await ok(claim(10,'bob'))).output.claims,[{id:id('root'),token:`${id('root')}:2`,value}]);
    assert.deepEqual((await ok(settle('root',1,11))).output,{accepted:false});
    assert.deepEqual((await ok(settle('root',2,11,{worker:'bob'}))).output,{accepted:true});
    const duplicate=await ok(settle('root',2,12,{worker:'bob'}));
    assert.deepEqual(duplicate.output,{accepted:false});
    assert.deepEqual(duplicate.state.effects,[{jobId:id('root'),value}]);
    assert.deepEqual(duplicate.state.jobs[0],{...job('root'),status:'done',attempt:2,availableAt:0,owner:null,token:null,leaseUntil:null});
  });
  await scenario(criterionIds[2], async ({init,ok}) => {
    await init([job('root'),job('other',[],1)]); await ok(claim(0,'alice',{limit:1}));
    await ok(settle('root',1,1,{ok:false}));
    assert.equal((await ok({action:'inspect',now:1})).state.jobs[0].availableAt,4);
    assert.deepEqual((await ok(claim(3,'alice',{limit:1}))).output.claims.map(c=>c.id),[id('other')]);
    await ok(claim(4)); await ok(settle('root',2,5,{ok:false}));
    assert.equal((await ok({action:'inspect',now:5})).state.jobs[0].availableAt,11);
    assert.deepEqual((await ok(claim(10))).output,{claims:[]});
    await ok(claim(11)); await ok(settle('root',3,12,{ok:false}));
    const r=await ok(claim(13,'alice',{limit:1}));
    assert.deepEqual(r.output,{claims:[]}); assert.deepEqual(r.state.jobs.map(j=>j.status),['failed','failed']);
    assert.deepEqual(r.state.jobs.map(j=>j.attempt),[3,1]); assert.deepEqual(r.state.effects,[]);
  });
  await scenario(criterionIds[3], async ({init,ok}) => {
    await init([job('tail',['mid']),job('mid',['root']),job('root',[],1),job('other'),job('last')]);
    await ok(claim(0,'alice',{limit:1}));
    const r=await ok(claim(10,'alice',{limit:1}));
    assert.deepEqual(r.output.claims.map(c=>c.id),[id('other')]);
    assert.deepEqual(r.state.jobs.map(j=>j.status),['cancelled','cancelled','failed','leased','ready']);
    const cancelled=await ok({action:'cancel',now:11,id:id('other')});
    assert.deepEqual(cancelled.state.jobs[3],{...job('other'),status:'cancelled',attempt:1,availableAt:0,owner:null,token:null,leaseUntil:null});
    assert.deepEqual((await ok(settle('other',1,12))).output,{accepted:false});
    await ok(claim(12)); await ok(settle('last',1,13));
    for(const k of ['root','tail','other','last']) {
      const out=await ok({action:'cancel',now:14,id:id(k)}); assert.equal(out.after,out.before);
    }
  });
  await scenario(criterionIds[4], async ({run,ok}) => {
    let r=await run({action:'init',now:0,jobs:[job('root')],crashAt:'before-rename'});
    assert.equal(r.signal,'SIGKILL'); assert.equal(r.after,null);
    r=await run({action:'init',now:0,jobs:[job('root')],crashAt:'after-rename'});
    assert.equal(r.signal,'SIGKILL'); assert.equal(JSON.parse(r.after).jobs[0].status,'ready');
    r=await run({...claim(0),crashAt:'before-rename'}); assert.equal(r.signal,'SIGKILL'); assert.equal(r.after,r.before);
    r=await run({...claim(0),crashAt:'after-rename'}); assert.equal(r.signal,'SIGKILL'); assert.equal(JSON.parse(r.after).jobs[0].attempt,1);
    r=await run({...settle('root',1,1),crashAt:'before-rename'}); assert.equal(r.signal,'SIGKILL'); assert.equal(r.after,r.before);
    r=await run({...settle('root',1,1),crashAt:'after-rename'}); assert.equal(r.signal,'SIGKILL');
    assert.deepEqual(JSON.parse(r.after).effects,[{jobId:id('root'),value}]); assert.equal(JSON.parse(r.after).jobs[0].status,'done');
    for(const request of [settle('root',1,2),{action:'cancel',now:2,id:id('root')},claim(2)]) {
      for(const crashAt of ['before-rename','after-rename']) {
        r=await run({...request,crashAt}); assert.equal(r.signal,'SIGKILL'); assert.equal(r.after,r.before);
      }
    }
    assert.deepEqual((await ok(settle('root',1,3))).output,{accepted:false});
  });
  await scenario(criterionIds[5], async ({invalid,init,ok}) => {
    for(const jobs of [null,[job('x'),job('x')],[job('x',['missing'])],[job('x',['x'])],[job('x',['y']),job('y',['x'])],
      [{...job('x'),deps:[id('x'),id('x')]}],[{...job('x'),extra:1}],[{...job('x'),id:'bad.id'}],[{...job('x'),maxAttempts:9}],
      [{...job('x'),value:1.1}],[{...job('x'),value:Number.MAX_SAFE_INTEGER+1}]]) await invalid({action:'init',now:0,jobs});
    await invalid({}, {raw:'{invalid'}); await invalid({}, {raw:'null'});
    await invalid({action:'inspect',now:0});
    await init([job('root')]);
    for(const request of [
      {action:'init',now:0,jobs:[]},{action:'inspect',now:-1},{action:'inspect',now:0,extra:1},
      {action:'inspect',now:0,crashAt:'after-rename'},{action:'toString',now:0},claim(0,'a',{limit:0}),
      claim(0,'a',{limit:9}),claim(0,'a',{leaseMs:1001}),claim(0,'bad worker'),claim(0,'a',{crashAt:'bad'}),
      claim(Number.MAX_SAFE_INTEGER),settle('missing',1,0),settle('root',1,0,{ok:1}),settle('root',1,0,{retryMs:0}),
      {action:'cancel',now:0,id:id('missing')},
    ]) await invalid(request);
    await ok(claim(Number.MAX_SAFE_INTEGER-10));
    await invalid(settle('root',1,Number.MAX_SAFE_INTEGER-9,{ok:false,retryMs:1000}));
  });
  await scenario(criterionIds[6], async ({run,init,ok}) => {
    await init([]);
    const r=await run({action:'inspect',now:0},{junk:true});
    assert.equal(r.code,0); assert.equal(r.before,r.after); assert.ok(r.unchangedFile);
    assert.deepEqual(JSON.parse(r.stdout),{jobs:[],effects:[]});
    const c=await ok(claim(0)); assert.deepEqual(c.output,{claims:[]});
    assert.deepEqual(c.files.sort(),['snapshot-abandoned.tmp','state.json']);
  });
  return verdicts;
}
