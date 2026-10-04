import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { run, redact, runtimeEnv } from './process.mjs';

test('argv is passed literally, process failures propagate and logs redact common tokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmcrews process '));
  try {
    const log = join(root, 'setup.log');
    const result = await run(process.execPath, ['-e', 'console.log(process.argv[1]);', '; echo unsafe'], { log });
    assert.equal(result.output.trim(), '; echo unsafe');
    await run(process.execPath, ['-e', 'console.log("token=secret");'], { log });
    assert.doesNotMatch(await readFile(log, 'utf8'), /secret/);
    await assert.rejects(run(process.execPath, ['-e', 'process.exit(7)']), /exit 7/);
    await assert.rejects(run(join(root, 'missing'), []), /ENOENT/);
    assert.equal(redact('password=secret sk-abcdef ghp_abcdef'), 'password=[REDACTED] [REDACTED] [REDACTED]');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('managed Node is propagated on PATH for agent child processes', () => {
  const env = runtimeEnv();
  const path = env[Object.keys(env).find(key => key.toLowerCase() === 'path')];
  assert.equal(path.split(delimiter)[0], dirname(process.execPath));
});

test('bounded commands stop instead of hanging setup', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 100 }), /timed out/);
});
