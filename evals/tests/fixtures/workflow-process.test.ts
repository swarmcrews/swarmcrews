import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TaskDefinitionSchema } from '../../schemas/index.js';
import { processExecutor } from '../../src/graders/executor.js';
const root = resolve(import.meta.dirname,'../..');
const id = 'workflow-recovery-complex';
async function grade(file?: string, from?: string, to?: string, seed = 'development-1') {
  const dir=await mkdtemp(join(tmpdir(),'workflow-oracle-'));
  try {
    const fixture=await import(`../../tasks/${id}/fixture.mjs`);
    const oracle=await import(`../../ground-truth/${id}/oracle.mjs`);
    await fixture.materialize({destination:dir});
    if(file!=='starter') await cp(join(root,'ground-truth',id,'reference'),dir,{recursive:true});
    if(file && file!=='starter') {
      const path=join(dir,'src',file);const source=await readFile(path,'utf8');
      expect(source).toContain(from);await writeFile(path,source.replace(from!,to!));
    }
    return await oracle.gradeFiles({seed,execute:processExecutor(dir,5000)});
  } finally {await rm(dir,{recursive:true,force:true});}
}
describe('durable workflow benchmark',()=>{
  it('public smoke runs the reference using regular-file subprocess input',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'workflow-smoke-'));
    try {
      const fixture=await import(`../../tasks/${id}/fixture.mjs`);
      await fixture.materialize({destination:dir});
      await cp(join(root,'ground-truth',id,'reference'),dir,{recursive:true});
      const result=await processExecutor(dir,10000)({command:'node',args:['smoke.mjs']});
      expect(result.code,result.stderr).toBe(0);
      expect(result.stdout).toContain('public workflow smoke passed');
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
  it('manifest and grader criteria agree; fixture hides reference and grader',async()=>{
    const manifest=TaskDefinitionSchema.parse(JSON.parse(await readFile(join(root,'tasks',id,'manifest.json'),'utf8')));
    const oracle=await import(`../../ground-truth/${id}/oracle.mjs`);
    const fixture=await import(`../../tasks/${id}/fixture.mjs`);
    expect(oracle.criterionIds).toEqual(manifest.criteria.map(c=>c.id));
    expect(oracle.revision).toBe(manifest.grader.revision);
    const files=(await fixture.build()).files;
    expect(Object.keys(files).sort()).toEqual(['README.md','smoke.mjs','src/index.mjs','src/scheduler.mjs','src/storage.mjs','src/validation.mjs']);
    expect(JSON.stringify(files)).not.toMatch(/ground-truth|oracle\.mjs/);
  });
  it('accepts reference across independent seeds and rejects starter',async()=>{
    for(const seed of ['development-1','validation-2','confirmation-3']){
      const verdicts=await grade(undefined,undefined,undefined,seed);
      expect(verdicts.every((v:{pass:boolean})=>v.pass),JSON.stringify(verdicts)).toBe(true);
    }
    expect((await grade('starter')).filter((v:{pass:boolean})=>!v.pass).length).toBeGreaterThanOrEqual(5);
  },60000);
  const mutations=[
    ['scheduler.mjs',"job.deps.every(id => state.jobs.find(dep => dep.id === id).status === 'done')",'true','dependencies'],
    ['scheduler.mjs','job.leaseUntil <= r.now','job.leaseUntil < r.now','fencing'],
    ['scheduler.mjs','job.owner === r.worker','true','fencing'],
    ['scheduler.mjs','job.token === r.token','true','fencing'],
    ['scheduler.mjs','r.now < job.leaseUntil','r.now <= job.leaseUntil','fencing'],
    ['scheduler.mjs','2 ** (job.attempt - 1)','1','retry'],
    ['scheduler.mjs',"clear(job, 'failed'); continue;","clear(job, 'failed'); break;",'cancellation'],
    ['scheduler.mjs','} while (changed);','} while (false);','cancellation'],
    ['scheduler.mjs','value: job.value','value: job.value + 1','fencing'],
    ['scheduler.mjs',"if (!Number.isSafeInteger(value)) throw Error('integer overflow');",'','validation'],
    ['validation.mjs',"Object.keys(value).some(key => ![...required, ...optional].includes(key))",'false','validation'],
    ['storage.mjs',"process.kill(process.pid, 'SIGKILL')",'process.exit(1)','atomicity'],
    ['index.mjs',"if (request.action !== 'inspect') save",'if (true) save','persistence'],
  ];
  for(const [file,from,to,criterion] of mutations) it(`rejects ${criterion}: ${from}`,async()=>{
    const verdicts=await grade(file,from,to);
    expect(verdicts.find((v:{criterionId:string})=>v.criterionId===`workflow.${criterion}`)?.pass,JSON.stringify(verdicts)).toBe(false);
  },30000);
  it('executor infrastructure failures escape scoring',async()=>{
    const oracle=await import(`../../ground-truth/${id}/oracle.mjs`);
    await expect(oracle.gradeFiles({execute:async()=>{throw Error('executor unavailable');}})).rejects.toMatchObject({kind:'grader-infrastructure'});
  });
});
