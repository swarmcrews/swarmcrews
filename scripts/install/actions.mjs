import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { run, probe, npmCli, runtimeEnv } from './process.mjs';
import { inspectDestination, REPOSITORY } from './core.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
export async function readSource(source) {
  const revision = probe('git', ['-C', source, 'rev-parse', 'HEAD']);
  if (!revision || !/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('Installer source must be a Git checkout. Use the platform bootstrap.');
  // Installation clones the committed revision, not dirty files in a developer checkout.
  const manifest = probe('git', ['-C', source, 'show', `${revision}:package.json`]);
  const pkg = JSON.parse(manifest || '{}');
  const pnpm = /^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$/.exec(pkg.packageManager || '')?.[1];
  if (pkg.name !== 'swarmcrews' || !pnpm) throw new Error('Source does not declare a pinned Swarmcrews package manager.');
  return { revision, pnpm, version: pkg.version };
}
export async function saveState(dir, state) {
  await mkdir(join(dir, '.swarmcrews-install'), { recursive: true, mode: 0o700 });
  await writeFile(join(dir, '.swarmcrews-install', 'state.json'), `${JSON.stringify({ ...state, schemaVersion: 1, directory: resolve(dir) }, null, 2)}\n`, { mode: 0o600 });
}
export async function prepareCheckout(source, dir, metadata) {
  const destination = await inspectDestination(dir);
  if (!['new', 'empty'].includes(destination.kind)) throw new Error('Destination changed or is not empty. No files were overwritten.');
  await mkdir(dirname(dir), { recursive: true });
  await run('git', ['clone', '--no-hardlinks', '--no-local', '--', source, dir]);
  // A failed clone is left visible, never recursively removed by setup.
  await run('git', ['checkout', '--detach', metadata.revision], { cwd: dir });
  await run('git', ['remote', 'set-url', 'origin', REPOSITORY], { cwd: dir });
  await saveState(dir, { ...metadata, phase: 'source' });
}
export async function assertManagedClean(dir, marker) {
  const dirty = probe('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: dir });
  if (dirty === null || dirty) throw new Error('Managed checkout has tracked changes. Preserve them and choose a new installation folder.');
  const revision = probe('git', ['rev-parse', 'HEAD'], { cwd: dir });
  if (revision !== marker.revision) throw new Error('Managed checkout revision changed. Choose a new installation folder; setup does not reset repositories.');
  const control = await lstat(join(dir, '.swarmcrews-install'));
  if (!control.isDirectory() || control.isSymbolicLink()) throw new Error('Installer state directory must not be a symlink.');
}
export async function installPackages(dir, pnpm, log, ui) {
  const tools = join(dir, '.swarmcrews-install', 'tools');
  await mkdir(tools, { recursive: true, mode: 0o700 });
  const cli = join(tools, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  if (probe(process.execPath, [cli, '--version']) !== pnpm) {
    const npm = await npmCli();
    ui.row('pending', `Provisioning private pnpm ${pnpm}`, 'Your global package manager is unchanged.');
    await run(process.execPath, [npm, 'install', '--prefix', tools, '--ignore-scripts', '--no-audit', '--no-fund', `pnpm@${pnpm}`], { cwd: dir, log });
  }
  ui.row('pending', 'Installing application dependencies', `Detailed output: ${log}`);
  const result = await run(process.execPath, [cli, 'install', '--frozen-lockfile'], {
    cwd: dir, log, env: runtimeEnv({ npm_config_manage_package_manager_versions: 'false' }),
  });
  ui.row('ok', 'Dependencies installed', `${result.seconds}s / frozen lockfile`);
  const require = createRequire(join(dir, 'package.json'));
  const sqlite = require.resolve('better-sqlite3');
  await run(process.execPath, ['--input-type=module', '-e',
    'const {default: Database} = await import(process.argv[1]); const db = new Database(":memory:"); try { db.prepare("SELECT 1").get(); } finally { db.close(); }',
    pathToFileURL(sqlite).href], { cwd: dir, log });
  ui.row('ok', 'SQLite native module', 'Opened and queried an in-memory database.');
}
export async function harnessStatus(dir) {
  const result = await run(process.execPath, ['--import', join(dir, 'scripts/register-typescript.mjs'), join(scripts, 'harness.mjs'), dir, 'check'], { cwd: dir, timeout: 60_000 });
  const payload = result.output.split('\n').find(line => line.startsWith('SWARMCREWS_READINESS='));
  if (!payload) throw new Error('Agent probe returned no readiness result.');
  return JSON.parse(payload.slice('SWARMCREWS_READINESS='.length));
}
export async function login(dir, agent) {
  return run(process.execPath, ['--import', join(dir, 'scripts/register-typescript.mjs'), join(scripts, 'harness.mjs'), dir, 'login', agent], { cwd: dir, interactive: true, timeout: 10 * 60_000 });
}
export async function writeLauncher(dir, ports) {
  // The command pins this Node executable, and carries it on PATH for agents.
  const script = `import { spawn } from 'node:child_process';\nimport { dirname, delimiter } from 'node:path';\nconst node = ${JSON.stringify(process.execPath)};\nconst env = { ...process.env, HOST: '127.0.0.1', PORT: ${JSON.stringify(String(ports.backend))}, VITE_PORT: ${JSON.stringify(String(ports.front))} };\nconst pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';\nenv[pathKey] = dirname(node) + delimiter + (env[pathKey] || '');\nconst action = process.argv[2] || 'status';\nif (!['start', 'stop', 'status', 'restart'].includes(action)) throw new Error('Use start, stop, status or restart.');\nconst child = spawn(node, [${JSON.stringify(join(dir, 'scripts/start.mjs'))}, action], { cwd: ${JSON.stringify(dir)}, env, stdio: 'inherit', shell: false });\nchild.on('error', e => { console.error(e.message); process.exitCode = 1; });\nchild.on('exit', code => { process.exitCode = code ?? 1; });\n`;
  await writeFile(join(dir, '.swarmcrews-install', 'manage.mjs'), script, { mode: 0o600 });
}
export async function ownedPid(dir) {
  try {
    const pid = Number((await readFile(join(dir, '.run/swarmcrews.pid'), 'utf8')).trim());
    if (!Number.isInteger(pid) || pid < 1) return null;
    process.kill(pid, 0); return pid;
  } catch { return null; }
}
