import { test } from 'node:test';
import assert from 'node:assert/strict';
import { experimentTreatment, isExperimentVariant } from './treatments.mjs';
test('all eight independent treatment combinations have deterministic bit order', () => {
  const seen = new Set();
  for (let n=0;n<8;n++) {
    const variant=`experiments-${n.toString(2).padStart(3,'0')}`;
    assert.equal(isExperimentVariant(variant),true);
    const flags=experimentTreatment(variant);
    assert.deepEqual(Object.values(flags),[Boolean(n&4),Boolean(n&2),Boolean(n&1)]);
    seen.add(JSON.stringify(flags));
  }
  assert.equal(seen.size,8);
  assert.equal(isExperimentVariant('experiments-112'),false);
  assert.deepEqual(experimentTreatment('baseline'),experimentTreatment('experiments-000'));
});
