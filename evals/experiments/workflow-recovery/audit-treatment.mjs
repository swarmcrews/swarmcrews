/** Read provider metadata only; never export rollout messages or credentials. */
import {readdir,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {join,resolve,basename} from 'node:path';
const [cellArg,model='gpt-5.6-sol',effort='medium']=process.argv.slice(2);
if(!cellArg)throw Error('audit-treatment.mjs CELL_DIRECTORY [model] [effort]');
const cell=resolve(cellArg), records=[];
async function walk(directory){
 let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
 for(const entry of entries){
  const path=join(directory,entry.name);
  if(entry.isDirectory())await walk(path);
  else if(entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')){
   const observed=new Set();
   for await(const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})){
    const item=JSON.parse(line);
    if(item.type==='turn_context')observed.add(JSON.stringify({model:item.payload.model,effort:item.payload.effort}));
   }
   for(const value of observed)records.push({file:basename(path),...JSON.parse(value)});
  }
 }
}
await walk(join(cell,'adapter-state','instances'));
const mismatches=records.filter(r=>r.model!==model||r.effort!==effort);
const result={source:'provider turn_context metadata',expected:{model,effort},records,status:records.length?(mismatches.length?'mismatch':'matched'):'unavailable'};
await writeFile(join(cell,'provider-treatment-audit.json'),JSON.stringify(result,null,2));
if(mismatches.length)await writeFile(join(cell,'treatment-violation.json'),JSON.stringify({reason:'Provider model/effort mismatch',mismatches},null,2));
console.log(JSON.stringify(result,null,2));
