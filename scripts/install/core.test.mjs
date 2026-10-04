import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, supportedNode, gitRepair, inspectDestination, validatePort, buildPlan } from './core.mjs';

test('arguments reject ambiguous unattended installs and unknown flags', () => {
  assert.throws(() => parseArgs(['--yes']), /--dir/);
  assert.throws(() => parseArgs(['--dir']), /value/);
  assert.throws(() => parseArgs(['--yes', '--dir', '/tmp/app']), /--agent/);
  assert.throws(() => parseArgs(['--wat']), /Unknown/);
  assert.equal(parseArgs(['--yes', '--dir', '/tmp/app', '--agent', 'later']).agent, 'later');
  assert.throws(() => parseArgs(['--agent', 'injected']), /agent/);
});

test('runtime and port requirements are precise', () => {
  for (const value of ['20.0.0', '22.11.9', 'bad']) assert.equal(supportedNode(value), false);
  for (const value of ['22.12.0', '22.22.0', '24.0.0']) assert.equal(supportedNode(value), true);
  for (const value of ['0', '-1', '65536', '3x', '']) assert.throws(() => validatePort(value), /port/i);
  assert.equal(validatePort('6173'), 6173);
});

test('Git repairs use explicit executable and argv, never a shell program', () => {
  assert.deepEqual(gitRepair('linux', ['apt-get']), { command: 'sudo', args: ['apt-get', 'install', 'git'] });
  assert.equal(gitRepair('linux', []).command, null);
  assert.equal(gitRepair('darwin', []).command, null);
  assert.equal(gitRepair('win32', ['winget']).command, 'winget');
});

test('destination guard never adopts an unrelated or symlinked directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmcrews-install-test-'));
  try {
    assert.equal((await inspectDestination(join(root, 'new'))).kind, 'new');
    await mkdir(join(root, 'empty'));
    assert.equal((await inspectDestination(join(root, 'empty'))).kind, 'empty');
    await writeFile(join(root, 'empty', 'user-file'), 'keep');
    assert.equal((await inspectDestination(join(root, 'empty'))).kind, 'unrelated');
    assert.equal((await inspectDestination(join(root, 'empty', 'user-file'))).kind, 'unrelated');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('plan reflects source install and separates authentication from app installation', () => {
  const plan = buildPlan({ dir: '/tools/swarmcrews', agent: 'later', pnpm: '10.15.1', revision: 'abcdef' });
  assert.ok(plan.some(line => line.includes('frozen lockfile')));
  assert.ok(plan.some(line => line.includes('pending')));
  assert.ok(plan.every(line => !line.includes('prebuilt')));
});
