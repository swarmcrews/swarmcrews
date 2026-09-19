import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const directory = mkdtempSync(join(tmpdir(), 'workflow-smoke-'));
function call(action, fields = {}, now = 0) {
  // Regular-file stdio also works inside the participant's restricted process sandbox.
  writeFileSync(join(directory,'input'),JSON.stringify({directory, now, action, ...fields}));
  const fds = [openSync(join(directory,'input'),'r'), openSync(join(directory,'out'),'w'), openSync(join(directory,'err'),'w')];
  let run;
  try { run = spawnSync(process.execPath, ['src/index.mjs'], {stdio:fds, timeout:3000}); }
  finally { fds.forEach(closeSync); }
  assert.ifError(run.error);
  assert.equal(run.status, 0, readFileSync(join(directory,'err'),'utf8'));
  return JSON.parse(readFileSync(join(directory,'out'),'utf8'));
}
try {
  call('init', {jobs: [
    {id: 'child', deps: ['root'], value: 9, maxAttempts: 2},
    {id: 'root', deps: [], value: 7, maxAttempts: 2},
  ]});
  assert.deepEqual(call('claim', {worker: 'w', limit: 2, leaseMs: 10}),
    {claims: [{id: 'root', token: 'root:1', value: 7}]}, 'dependencies gate claims');
  assert.deepEqual(call('settle', {id: 'root', worker: 'w', token: 'root:1', ok: true, retryMs: 3}),
    {accepted: true});
  assert.deepEqual(call('settle', {id: 'root', worker: 'w', token: 'root:1', ok: true, retryMs: 3}),
    {accepted: false}, 'duplicate completion is fenced');
  assert.equal(call('claim', {worker: 'w', limit: 2, leaseMs: 10}).claims[0].id, 'child');
  assert.deepEqual(call('inspect').effects, [{jobId: 'root', value: 7}]);
  console.log('public workflow smoke passed');
} finally { rmSync(directory, {recursive: true, force: true}); }
