import { spawn, spawnSync } from 'node:child_process';
import { appendFile, access } from 'node:fs/promises';
import { dirname, join, delimiter } from 'node:path';
import { clean, Cancelled } from './ui.mjs';

export function runtimeEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  const key = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[key] = [dirname(process.execPath), env[key] || ''].join(delimiter);
  return env;
}
export function probe(command, args = ['--version'], options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 8000, shell: false, windowsHide: true, env: runtimeEnv(), ...options });
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}
export const redact = text => String(text)
  .replace(/\b(sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+)\b/g, '[REDACTED]')
  .replace(/((?:token|password|api[_-]?key|authorization)\s*[:=]\s*)[^\s]+/gi, '$1[REDACTED]');
export async function npmCli() {
  const base = dirname(process.execPath);
  for (const file of [join(base, 'node_modules/npm/bin/npm-cli.js'), join(base, '../lib/node_modules/npm/bin/npm-cli.js')]) {
    try { await access(file); return file; } catch { /* Check the next standard layout. */ }
  }
  throw new Error('This Node distribution has no bundled npm. Rerun the platform bootstrap with SWARMCREWS_MANAGED_NODE=1 to use the managed runtime.');
}
export async function run(command, args, { cwd, env = runtimeEnv(), log, interactive = false, timeout = 15 * 60_000 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let output = '', cancelled = false, timedOut = false;
    let forceTimer;
    let writes = Promise.resolve();
    const child = spawn(command, args, {
      cwd, env, shell: false, windowsHide: !interactive,
      detached: process.platform !== 'win32' && !interactive,
      stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    const stop = (force = false) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
        else process.kill(interactive ? child.pid : -child.pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch { /* Already stopped. */ }
      if (!force && !forceTimer) forceTimer = setTimeout(() => stop(true), 3000);
    };
    const cancel = () => { cancelled = true; stop(); };
    process.once('SIGINT', cancel);
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    const collect = chunk => {
      output = (output + chunk.toString()).slice(-65536);
      if (log) writes = writes.then(() => appendFile(log, redact(chunk.toString()), { mode: 0o600 }));
      // Prevent an IO rejection from becoming unhandled before the child exits.
      void writes.catch(() => {});
    };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    let spawnError;
    child.once('error', error => { spawnError = error; });
    child.once('close', async code => {
      clearTimeout(timer); clearTimeout(forceTimer); process.off('SIGINT', cancel);
      try {
        await writes;
        if (cancelled) throw new Cancelled();
        if (spawnError) throw spawnError;
        if (timedOut) throw new Error('Operation timed out. Rerun setup to retry.');
        if (code !== 0) throw new Error(`Command failed (exit ${code}). ${clean(redact(output.slice(-1600)))}${log ? ` Log: ${log}` : ''}`);
        resolve({ output, seconds: ((Date.now() - started) / 1000).toFixed(1) });
      } catch (error) { reject(error); }
    });
  });
}
