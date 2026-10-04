import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('POSIX platform bootstraps stay behaviorally aligned', async () => {
  const normalize = value => value.replaceAll('\r\n', '\n').replaceAll('Linux', 'OS').replaceAll('macOS', 'OS').replaceAll('linux.sh', 'OS.sh').replaceAll('macos.sh', 'OS.sh').replace(/PLATFORM='(?:linux|darwin)'/, "PLATFORM='OS'");
  assert.equal(normalize(await readFile(join(root, 'install/linux.sh'), 'utf8')), normalize(await readFile(join(root, 'install/macos.sh'), 'utf8')));
});

test('installer modules use no third-party imports', async () => {
  for (const name of await readdir(join(root, 'scripts/install'))) {
    if (!name.endsWith('.mjs')) continue;
    const text = await readFile(join(root, 'scripts/install', name), 'utf8');
    for (const match of text.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('node:') || match[1].startsWith('./'), `${name}: unexpected import ${match[1]}`);
    }
  }
});

test('native platform bootstrap preview is read-only and shows the shared branded flow', () => {
  let command, args;
  if (process.platform === 'win32') {
    command = 'powershell.exe'; args = ['-NoProfile', '-File', join(root, 'install/windows.ps1'), '--preview'];
  } else {
    command = 'bash'; args = [join(root, `install/${process.platform === 'darwin' ? 'macos' : 'linux'}.sh`), '--preview'];
  }
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15_000, env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /SWARMCREWS/); assert.match(result.stdout, /DESIGN PREVIEW/);
  assert.doesNotMatch(result.stdout, /Download and install/);
});

test('all platform previews and unattended errors work without application dependencies', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const result = spawnSync(process.execPath, [join(root, 'scripts/install/wizard.mjs'), '--preview', '--platform', platform], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /nothing is installed/);
  }
  const invalid = spawnSync(process.execPath, [join(root, 'scripts/install/wizard.mjs'), '--yes'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1); assert.match(invalid.stdout, /--dir/);
});
