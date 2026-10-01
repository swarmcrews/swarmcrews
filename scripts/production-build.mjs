#!/usr/bin/env node
// Build away from the assets a running preview serves. A failed build must
// preserve both the old service and its frontend, not merely its PID.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDependencies } from './check-dependencies.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
checkDependencies(['typescript', 'vite']);
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc.js');
const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const temporary = mkdtempSync(join(root, '.swarmcrews-build-'));
const staged = join(temporary, 'dist');
const previous = join(temporary, 'previous-dist');
const serving = join(root, 'dist');
try {
  for (const [name, args] of [['TypeScript', [tsc, '-b']],
    ['Vite', [vite, 'build', '--outDir', staged, '--emptyOutDir']]]) {
    const result = spawnSync(process.execPath, args, {
      cwd: root, env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'inherit', shell: false, windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`${name}: ${result.error?.message ?? `exit ${result.status ?? result.signal}`}`);
    }
  }
  if (!existsSync(join(staged, 'index.html'))) throw new Error('Vite did not produce index.html');
  if (existsSync(serving)) renameSync(serving, previous);
  try {
    renameSync(staged, serving);
  } catch (error) {
    if (existsSync(previous)) renameSync(previous, serving);
    throw error;
  }
} catch (error) {
  console.error(`Swarmcrews production build failed (${error.message}).`);
  process.exitCode = 1;
} finally {
  // If activation rollback itself failed, retain the recoverable old assets.
  if (!existsSync(previous) || existsSync(serving)) rmSync(temporary, { recursive: true, force: true });
}
