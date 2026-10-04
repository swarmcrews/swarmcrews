import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { readSource, prepareCheckout, assertManagedClean } from './actions.mjs';
import { inspectDestination } from './core.mjs';
import { main } from './wizard.mjs';
import { Terminal } from './ui.mjs';

async function file(root, path, text) { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text); }
function git(dir, args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' } });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'swarmcrews setup #'));
  const source = join(root, 'source'); await mkdir(source);
  await file(source, 'package.json', JSON.stringify({ name: 'swarmcrews', version: '0.1.0', packageManager: 'pnpm@10.15.1', type: 'module' }));
  await file(source, '.gitignore', '.swarmcrews-install/\n');
  await file(source, 'scripts/start.mjs', 'throw new Error("start must not run in skip-start test");');
  // External package boundary fixture: no application modules are mocked.
  await file(source, 'node_modules/better-sqlite3/package.json', JSON.stringify({ name: 'better-sqlite3', main: 'index.cjs' }));
  await file(source, 'node_modules/better-sqlite3/index.cjs', 'module.exports = class { prepare() { return { get() { return 1; } }; } close() {} };');
  git(source, ['init', '-q']); git(source, ['add', '.']);
  git(source, ['-c', 'user.name=Installer Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  return { root, source, dir: join(root, 'installed app') };
}

test('source install pins committed revision and safely resumes with no real package downloads', async () => {
  const { root, source, dir } = await fixture();
  try {
    const metadata = await readSource(source);
    await prepareCheckout(source, dir, metadata);
    assert.equal(git(dir, ['rev-parse', 'HEAD']), metadata.revision);
    assert.equal(git(dir, ['remote', 'get-url', 'origin']), 'https://github.com/hipsterusername/minions.git');
    assert.equal((await inspectDestination(dir)).kind, 'managed');
    await file(dir, '.swarmcrews-install/tools/node_modules/pnpm/bin/pnpm.cjs', `if (process.argv[2] === '--version') console.log('10.15.1'); else if (process.argv.slice(2).join(' ') !== 'install --frozen-lockfile') process.exit(1);`);
    let text = ''; const output = new PassThrough(); output.on('data', value => { text += value; });
    const ui = new Terminal({ input: new PassThrough(), output, env: {} });
    for (let i = 0; i < 2; i++) {
      const code = await main(['--yes', '--dir', dir, '--agent', 'later', '--skip-start'], ui, source);
      assert.equal(code, 2, 'installed but authentication pending has a distinct result');
    }
    const state = JSON.parse(await readFile(join(dir, '.swarmcrews-install/state.json'), 'utf8'));
    assert.equal(state.phase, 'installed'); assert.equal(state.agentReady, false);
    assert.match(text, /Startup skipped/); assert.doesNotMatch(text, /Application reachable/);
    await assert.rejects(access(`${dir}.swarmcrews-install.lock`));
    const manage = spawnSync(process.execPath, [join(dir, '.swarmcrews-install/manage.mjs'), 'bad'], { encoding: 'utf8' });
    assert.notEqual(manage.status, 0); assert.match(manage.stderr, /Use start/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent setup is blocked and failed dependency work can be retried without deleting source', async () => {
  const { root, source, dir } = await fixture();
  const ui = new Terminal({ input: new PassThrough(), output: new PassThrough(), env: {} });
  try {
    const metadata = await readSource(source);
    await prepareCheckout(source, dir, metadata);
    const args = ['--yes', '--dir', dir, '--agent', 'later', '--skip-start'];
    await writeFile(`${dir}.swarmcrews-install.lock`, '');
    await assert.rejects(main(args, ui, source), /Another setup/);
    await rm(`${dir}.swarmcrews-install.lock`);
    await file(dir, '.swarmcrews-install/tools/node_modules/pnpm/bin/pnpm.cjs', "if (process.argv[2] === '--version') console.log('10.15.1'); else process.exit(42);");
    await assert.rejects(main(args, ui, source), /exit 42/);
    assert.equal((await inspectDestination(dir)).kind, 'managed');
    assert.equal(git(dir, ['rev-parse', 'HEAD']), metadata.revision);
    await assert.rejects(access(`${dir}.swarmcrews-install.lock`));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('dirty tracked checkout and unrelated directory are preserved', async () => {
  const { root, source, dir } = await fixture();
  try {
    const metadata = await readSource(source);
    await prepareCheckout(source, dir, metadata);
    await writeFile(join(dir, 'package.json'), 'user changes');
    await assert.rejects(assertManagedClean(dir, metadata), /tracked changes/);
    await assert.rejects(prepareCheckout(source, dir, metadata), /not empty/);
    assert.equal(await readFile(join(dir, 'package.json'), 'utf8'), 'user changes');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('destination symlink cannot be adopted', async () => {
  const { root, source } = await fixture();
  try {
    await symlink(source, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await inspectDestination(join(root, 'link'))).kind, 'unrelated');
  } finally { await rm(root, { recursive: true, force: true }); }
});
