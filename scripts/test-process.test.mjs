import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { waitForOutput, stopTestProcess } from './test-process.mjs';

function fixture(t, code) {
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => stopTestProcess(child));
  return child;
}
const alive = 'setInterval(() => {}, 1000);';

test('readiness accepts ANSI sequences split across output chunks', { timeout: 5000 }, async t => {
  const child = fixture(t, `process.stdout.write('http://127.0.0.1:\\x1b[');
    setImmediate(() => process.stdout.write('1m4321\\x1b[22m/\\n')); ${alive}`);
  const output = await waitForOutput(child, ':4321/', { signal: t.signal });
  assert.match(output, /\x1b\[1m4321/);
  assert.equal(child.listenerCount('close'), 0);
  await stopTestProcess(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('stalled readiness rejects on deadline and the process can be reaped', { timeout: 5000 }, async t => {
  const child = fixture(t, `console.log('armed'); ${alive}`);
  await waitForOutput(child, 'armed', { signal: t.signal });
  await assert.rejects(waitForOutput(child, 'never ready', { timeoutMs: 20, signal: t.signal }), /readiness timed out/);
  assert.equal(child.stdout.listenerCount('data'), 0);
  await stopTestProcess(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('test cancellation interrupts pending and already-aborted readiness', { timeout: 5000 }, async t => {
  const child = fixture(t, alive);
  const controller = new AbortController();
  const pending = waitForOutput(child, 'never ready', { signal: controller.signal });
  controller.abort(new Error('test cancelled'));
  await assert.rejects(pending, /test cancelled/);
  await assert.rejects(waitForOutput(child, 'never ready', { signal: controller.signal }), /test cancelled/);
  assert.equal(child.listenerCount('close'), 0);
});

test('early exit and spawn errors fail readiness with diagnostics', { timeout: 5000 }, async t => {
  const child = fixture(t, 'console.error("fixture diagnostic"); process.exit(7);');
  await assert.rejects(waitForOutput(child, 'ready', { signal: t.signal }), /exited before readiness \(7\).*\nfixture diagnostic/s);
  await stopTestProcess(child); // Already-exited processes must not wait for another exit event.
  const missing = spawn(join(tmpdir(), 'swarmcrews-missing-test-executable'), [], { stdio: 'pipe' });
  try { await assert.rejects(waitForOutput(missing, 'ready', { signal: t.signal }), /ENOENT/); }
  finally { await stopTestProcess(missing); }
});

test('cleanup escalates when a POSIX child ignores SIGTERM', { timeout: 5000, skip: process.platform === 'win32' }, async t => {
  const child = fixture(t, `process.on('SIGTERM', () => {}); console.log('armed'); ${alive}`);
  await waitForOutput(child, 'armed', { signal: t.signal });
  await stopTestProcess(child, { graceMs: 20 });
  assert.equal(child.signalCode, 'SIGKILL');
});
