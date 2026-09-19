import {expect,it} from 'vitest';
// Native experiment scripts are controller entry points, outside the participant.
const {compare}=await import('../../experiments/workflow-recovery/compare.mjs');
const row=(repetition:number)=>({split:'confirmation',repetition,complete:true,passed:true,ms:100,tokens:100,coverage:'complete',runtimeHash:'r',oracleHash:'o',fixtureHash:'f',protocolHash:'p',model:'m',effort:'medium'});
it('requires quality, matched provenance, complete usage, repeated latency gain and bounded cost',()=>{
 const base=Array.from({length:5},(_,i)=>row(i+1));
 const better=base.map(x=>({...x,ms:70,tokens:120}));
 expect(compare(base,better).accepted).toBe(true);
 for(const change of [{passed:false},{complete:false},{coverage:'partial'},{runtimeHash:'other'},{tokens:130},{ms:200},{repetition:6}]){
  const modified=better.map(x=>({...x,...change}));
  expect(compare(base,modified).accepted,JSON.stringify(change)).toBe(false);
 }
 expect(compare(base.slice(0,1),better.slice(0,1)).accepted).toBe(false);
 expect(compare(base,better.slice(0,4)).accepted).toBe(false);
 expect(compare([],[]).accepted).toBe(false);
});
it('one fast outlier does not establish a latency advantage',()=>{
 const base=Array.from({length:5},(_,i)=>row(i+1));
 expect(compare(base,base.map((x,i)=>({...x,ms:i===0?1:101}))).accepted).toBe(false);
});
