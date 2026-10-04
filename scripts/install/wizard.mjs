#!/usr/bin/env node
import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Terminal, Cancelled } from './ui.mjs';
import { AGENTS, parseArgs, supportedNode, inspectDestination, buildPlan, validatePort, gitRepair } from './core.mjs';
import { probe, run, runtimeEnv } from './process.mjs';
import { portAvailable, waitForApplication } from './health.mjs';
import { readSource, prepareCheckout, assertManagedClean, installPackages, harnessStatus, login, saveState, writeLauncher, ownedPid } from './actions.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const names = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
const guides = {
  claude: 'https://code.claude.com/docs/en/setup', codex: 'https://developers.openai.com/codex/cli/',
  copilot: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
  opencode: 'https://opencode.ai/docs/', pi: 'https://github.com/earendil-works/pi/tree/main/packages/coding-agent',
};
export function preview(ui, platform) {
  ui.header(platform);
  ui.note('DESIGN PREVIEW / sample values only / nothing is installed');
  ui.step(1, 'Meet your crew'); ui.row('ok', 'Node.js 22.22.0', 'Existing runtime / unchanged'); ui.row('ok', 'Git', 'Ready for isolated agent workspaces');
  ui.step(2, 'Make it yours'); ui.note('Application: ~/swarmcrews'); ui.note('Agent: Claude Code');
  ui.step(3, 'Review the flight plan'); ui.note('Private pnpm. Frozen dependencies. Local access only.'); ui.note('Install this plan? [y/N]');
  ui.step(4, 'Assemble your workspace'); ui.row('ok', 'Dependencies installed'); ui.row('ok', 'SQLite native module');
  ui.step(5, 'Connect an agent'); ui.row('pending', 'Sign-in is your choice', 'Use the official login, or finish later.');
  ui.step(6, 'Ready for your first task'); ui.row('ok', 'Application reachable', 'Frontend + API + WebSocket'); ui.note('http://localhost:6173'); ui.note('Your workspace. Your agents. Your next move.');
}
async function retry(ui, yes, label, action) {
  while (true) {
    try { return await action(); } catch (error) {
      if (error instanceof Cancelled || yes) throw error;
      ui.row('error', label, error.message);
      if (!await ui.confirm('Retry this step?')) throw error;
    }
  }
}
async function choosePort(ui, initial, yes, label) {
  let port = validatePort(initial);
  while (!await portAvailable(port)) {
    if (yes) throw new Error(`${label} port ${port} is occupied. Choose explicit --port and --backend-port values; no processes were stopped.`);
    ui.row('error', `${label} port ${port} is occupied`, 'Existing processes will not be stopped.');
    try { port = validatePort(await ui.ask('Choose another port', String(port === 65535 ? 1024 : port + 1))); }
    catch (error) { if (error instanceof Cancelled) throw error; ui.note(error.message); }
  }
  return port;
}
export async function main(argv = process.argv.slice(2), ui = new Terminal(), sourceRoot = source) {
  const options = parseArgs(argv);
  if (options.help) {
    ui.note('Swarmcrews setup: node scripts/install/wizard.mjs [options]');
    ui.note('--dir PATH  --agent claude|codex|copilot|opencode|pi|later');
    ui.note('--yes (requires --dir and --agent; never approves system package installs)');
    ui.note('--check (read-only host checks)  --skip-start  --port N  --backend-port N');
    ui.note('--preview [--platform linux|darwin|win32] (no changes)'); return 0;
  }
  const platform = options.platform || process.platform;
  if (!names[platform]) throw new Error('Supported platform paths: linux, darwin, win32.');
  if (options.preview) { preview(ui, names[platform]); return 0; }
  if (platform !== process.platform) throw new Error('--platform is only available with --preview.');
  ui.header(names[platform]);
  ui.step(1, 'Meet your crew');
  if (!supportedNode(process.versions.node)) throw new Error('Node >=22.12.0 required. Use the platform bootstrap to provision a managed runtime.');
  ui.row('ok', `Node.js ${process.versions.node}`, process.execPath);
  let git = probe('git');
  if (!git && !options.check) {
    const managers = ['apt-get', 'dnf', 'pacman', 'zypper', 'brew', 'winget'].filter(name => probe(name) !== null);
    const repair = gitRepair(platform, managers);
    if (!repair.command) throw new Error(repair.help);
    ui.row('pending', 'Git is required', `${repair.command} ${repair.args.join(' ')}`);
    if (options.yes || !await ui.confirm('Run this system package command?')) throw new Error('Install Git manually, reopen the terminal and rerun setup.');
    await run(repair.command, repair.args, { interactive: true });
    git = probe('git');
  }
  ui.row(git ? 'ok' : 'error', 'Git', git || 'Missing; install Git and reopen your terminal.');
  if (options.check) {
    const frontend = await portAvailable(validatePort(options.port || 6173));
    const backend = await portAvailable(validatePort(options['backend-port'] || 3141));
    ui.row(frontend ? 'ok' : 'pending', 'Frontend port', frontend ? 'Available' : 'Occupied; may be an existing installation');
    ui.row(backend ? 'ok' : 'pending', 'Backend port', backend ? 'Available' : 'Occupied; may be an existing installation');
    ui.note('Read-only check complete. Native modules and agent readiness are checked after installation.'); return git ? 0 : 1;
  }
  if (!git) throw new Error('Git is not on PATH. Reopen your terminal and rerun setup.');
  if (!options.yes && (!ui.input.isTTY || !ui.output.isTTY)) throw new Error('Run setup in an interactive terminal, or supply --yes --dir PATH --agent NAME.');
  ui.step(2, 'Make it yours');
  const dir = resolve(options.dir || await ui.ask('Where should Swarmcrews live?', join(homedir(), 'swarmcrews')));
  const destination = await inspectDestination(dir);
  if (destination.kind === 'unrelated') throw new Error('That folder contains files not owned by this installer. Choose an empty folder with --dir; nothing was overwritten.');
  const agent = options.agent || await ui.choose('Choose one agent. Others can be added later.', AGENTS.map(value => ({ value, label: value === 'later' ? 'Set up an agent later' : value })), 0);
  let metadata = destination.kind === 'managed' ? destination.marker : await readSource(sourceRoot);
  if (destination.kind === 'managed') await assertManagedClean(dir, metadata);
  ui.step(3, 'Review the flight plan');
  buildPlan({ ...metadata, dir, agent }).forEach(line => ui.note(line));
  if (destination.kind === 'managed') ui.note('Resume this exact revision. Setup does not pull updates or reset files.');
  if (!options.yes && !await ui.confirm('Install this plan?')) throw new Cancelled();
  await mkdir(dirname(dir), { recursive: true });
  const lockPath = `${dir}.swarmcrews-install.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Another setup may be active. Lock: ${lockPath}. Remove it only after confirming no installer is running.`); throw error; }
  const controller = new AbortController();
  const cancel = () => controller.abort(new Cancelled());
  const checkpoint = () => controller.signal.throwIfAborted();
  process.on('SIGINT', cancel);
  try {
    if (destination.kind !== 'managed') await prepareCheckout(sourceRoot, dir, metadata);
    checkpoint();
    const log = join(dir, '.swarmcrews-install', 'install.log');
    const running = await ownedPid(dir);
    const ports = {
      front: validatePort(options.port || metadata.ports?.front || 6173),
      backend: validatePort(options['backend-port'] || metadata.ports?.backend || 3141),
    };
    if (ports.front === ports.backend) throw new Error('Frontend and backend ports must differ.');
    if (running) {
      if (JSON.stringify(ports) !== JSON.stringify(metadata.ports)) throw new Error('Stop the managed service before changing its ports.');
      ui.row('ok', 'Existing service detected', 'Dependencies and running processes will be left unchanged.');
    } else if (!options['skip-start']) {
      ports.front = await choosePort(ui, ports.front, options.yes, 'Frontend');
      ports.backend = await choosePort(ui, ports.backend, options.yes, 'Backend');
      if (ports.front === ports.backend) throw new Error('Frontend and backend ports must differ. Rerun with distinct ports.');
    }
    checkpoint();
    ui.step(4, 'Assemble your workspace');
    if (!running) await retry(ui, options.yes, 'Dependency installation needs attention', () => installPackages(dir, metadata.pnpm, log, ui));
    checkpoint();
    await writeLauncher(dir, ports);
    metadata = { ...metadata, agent, ports, phase: 'installed' };
    await saveState(dir, metadata);
    checkpoint();
    ui.step(5, 'Connect an agent');
    let ready = false;
    if (agent !== 'later') {
      ui.row('pending', 'Checking agent readiness', 'Bounded runtime, authentication and model checks.');
      try {
        let states = await harnessStatus(dir);
        let status = states.find(item => item.name === agent);
        ready = Boolean(status?.ready);
        while (!ready && !options.yes) {
          ui.row('pending', agent, status?.state || 'probe_failed');
          ui.note(guides[agent]);
          ui.note('Setup does not install third-party agents or collect credentials.');
          const action = await ui.choose('How would you like to continue?', [
            { value: 'later', label: 'Finish setup; authenticate later' },
            { value: 'login', label: 'Open the official agent login (not logged by setup)' },
            { value: 'retry', label: 'I fixed it in another terminal; check again' },
          ]);
          if (action === 'later') break;
          if (action === 'login') { try { await login(dir, agent); } catch (error) { if (error instanceof Cancelled) throw error; ui.row('error', 'Login not completed', error.message); } }
          states = await harnessStatus(dir); status = states.find(item => item.name === agent); ready = Boolean(status?.ready);
        }
      } catch (error) { if (error instanceof Cancelled) throw error; ui.row('pending', 'Agent check incomplete', error.message); }
    }
    ui.row(ready ? 'ok' : 'optional', ready ? `${agent} ready` : 'Agent authentication pending', ready ? 'An agent is ready for your first task.' : 'The application can run; agent tasks need a ready provider.');
    checkpoint();
    ui.step(6, 'Ready for your first task');
    const url = `http://127.0.0.1:${ports.front}`;
    if (!options['skip-start']) {
      if (!running) {
        ui.row('pending', 'Building and starting Swarmcrews', `This source install builds locally. Log: ${log}`);
        await run(process.execPath, [join(dir, 'scripts/start.mjs'), 'start'], { cwd: dir, log, env: runtimeEnv({ HOST: '127.0.0.1', PORT: String(ports.backend), VITE_PORT: String(ports.front) }) });
      }
      await retry(ui, options.yes, 'Application is not reachable yet', () => waitForApplication(url, 30_000, controller.signal));
      ui.row('ok', 'Application reachable', 'Frontend + backend API + WebSocket handshake'); ui.note(url);
    } else ui.row('optional', 'Startup skipped', 'Application health has not been verified.');
    await saveState(dir, { ...metadata, phase: options['skip-start'] ? 'installed' : 'running', agentReady: ready });
    ui.note('Manage from any folder:');
    const quote = value => process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
    ui.command(`${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} ${quote(join(dir, '.swarmcrews-install/manage.mjs'))} status`);
    ui.note('Replace status with start, stop or restart. No startup-at-login changes were made.');
    if (!options.yes && !options['skip-start'] && await ui.confirm('Open Swarmcrews in your browser?')) {
      const command = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
      try { await run(command[0], command[1], { timeout: 10_000 }); } catch { ui.note(`Open this address manually: ${url}`); }
    }
    ui.note('Your workspace. Your agents. Your next move.');
    checkpoint();
    return ready ? 0 : 2;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    process.off('SIGINT', cancel);
    await lock.close(); await unlink(lockPath);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    const ui = new Terminal(); ui.row(error instanceof Cancelled ? 'optional' : 'error', error instanceof Cancelled ? 'Setup cancelled' : 'Setup needs attention', error.message);
    process.exitCode = error instanceof Cancelled ? 130 : 1;
  });
}
