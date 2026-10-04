import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const AGENTS = ['claude', 'codex', 'copilot', 'opencode', 'pi', 'later'];
export const REPOSITORY = 'https://github.com/swarmcrews/swarmcrews.git';
export function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--yes', '--help', '--preview', '--check', '--skip-start'].includes(arg)) result[arg.slice(2)] = true;
    else if (['--dir', '--agent', '--platform', '--port', '--backend-port'].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${arg} needs a value.`);
      result[arg.slice(2)] = argv[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (result.yes && !result.dir) throw new Error('--yes requires --dir PATH.');
  if (result.yes && !result.agent) throw new Error('--yes requires --agent NAME or --agent later.');
  if (result.agent && !AGENTS.includes(result.agent)) throw new Error(`Unknown agent. Choose ${AGENTS.join(', ')}.`);
  if (result.port) validatePort(result.port);
  if (result['backend-port']) validatePort(result['backend-port']);
  return result;
}
export function supportedNode(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}
export function validatePort(value) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  return Number(value);
}
export function gitRepair(platform, commands) {
  if (platform === 'linux') {
    for (const [manager, args] of [
      ['apt-get', ['install', 'git']], ['dnf', ['install', 'git']], ['pacman', ['-S', 'git']], ['zypper', ['install', 'git']],
    ]) if (commands.includes(manager)) return { command: 'sudo', args: [manager, ...args] };
  }
  if (platform === 'darwin' && commands.includes('brew')) return { command: 'brew', args: ['install', 'git'] };
  if (platform === 'win32' && commands.includes('winget')) return { command: 'winget', args: ['install', '--id', 'Git.Git', '--exact', '--source', 'winget'] };
  return { command: null, args: [], help: platform === 'darwin' ? 'Install Apple Command Line Tools: xcode-select --install; then rerun setup.' : 'Install Git using https://git-scm.com/downloads, reopen your terminal, then rerun setup.' };
}
export async function inspectDestination(dir) {
  let stat;
  try { stat = await lstat(dir); } catch (error) { if (error.code === 'ENOENT') return { kind: 'new' }; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return { kind: 'unrelated' };
  if (!(await readdir(dir)).length) return { kind: 'empty' };
  try {
    const marker = JSON.parse(await readFile(join(dir, '.swarmcrews-install', 'state.json'), 'utf8'));
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    if (marker.schemaVersion === 1 && marker.directory === resolve(dir) && pkg.name === 'swarmcrews') return { kind: 'managed', marker };
  } catch { /* An arbitrary checkout is never implicitly adopted. */ }
  return { kind: 'unrelated' };
}
export function buildPlan({ dir, agent, pnpm, revision }) {
  return [
    `Application: ${dir}`, `Source revision: ${revision}`, `Package manager: pnpm ${pnpm} (private tools directory)`,
    'Install application dependencies with a frozen lockfile; build on this computer.',
    agent === 'later' ? 'Agent authentication: pending; finish later in the application.' : `Agent: ${agent}; use its official login flow.`,
    'Local access only. No shell-profile edits, remote exposure or startup-at-login changes.',
  ];
}
