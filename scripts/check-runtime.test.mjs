import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for (const version of ['20.19.0', '21.7.3', '22.0.0', '22.11.0']) {
  test(`rejects unsupported Node ${version} before importing dependencies`, async () => {
    const { checkRuntime } = await import('./check-runtime.mjs');
    assert.throws(() => checkRuntime(version), /Node\.js.*22\.12\.0.*pnpm install/);
  });
}
for (const version of ['22.12.0', '22.22.0', '24.0.0', '26.7.0']) {
  test(`accepts supported Node ${version}`, async () => {
    const { checkRuntime } = await import('./check-runtime.mjs');
    assert.doesNotThrow(() => checkRuntime(version));
  });
}

test('startup dependency guard reports the runtime upgrade instead of a loader error', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    Object.defineProperty(process.versions, 'node', { value: '22.11.0' });
    const { checkDependencies } = await import('./scripts/check-dependencies.mjs');
    checkDependencies();
  `], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Node\.js.*22\.12\.0.*pnpm install/);
  assert.doesNotMatch(result.stderr, /at checkRuntime|ERR_MODULE_NOT_FOUND/);
});

test('declared engine matches the frontend minimum runtime', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.engines.node, '>=22.12.0');
});
