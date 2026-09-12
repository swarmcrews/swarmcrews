import { expect, it } from 'vitest';
import { resolveTreatment } from './treatment.js';
import { CodexRawAdapter } from './codex.js';
import { MinionSingleAdapter } from './swarmcrews.js';
import { ManagedSwarmcrewsAdapter } from './managed-swarmcrews.js';
it.each(['low','medium','high','xhigh','max'])('resolves %s exactly',effort=>{
  expect(resolveTreatment({model:'fixture',reasoningEffort:effort})).toEqual({model:'fixture',thinkingConfig:{enabled:true,effort,display:'summarized'}});
});
it.each([{reasoningEffort:'ultra'},{temperature:0.2},{reasoningEffort:3},{model:42},{thinkingConfig:{enabled:true}}])('rejects unsupported treatment during preflight before any provider boundary: %j',async settings=>{
  const config={schemaVersion:1 as const,adapterId:'minion-single',settings,requiredCapabilities:[]};
  expect(()=>resolveTreatment(settings)).toThrow();
  await expect(new MinionSingleAdapter(undefined).preflight(config)).rejects.toThrow();
  await expect(new ManagedSwarmcrewsAdapter(config).preflight(config)).rejects.toThrow();
  await expect(new CodexRawAdapter(undefined as never).preflight(config)).rejects.toThrow();
});
