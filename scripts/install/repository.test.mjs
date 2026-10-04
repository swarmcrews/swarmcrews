import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REPOSITORY } from './core.mjs';

const repository = 'https://github.com/swarmcrews/swarmcrews';
const raw = 'https://raw.githubusercontent.com/swarmcrews/swarmcrews/main/install/';
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('all native bootstraps fetch the canonical source repository', async () => {
  assert.equal(REPOSITORY, `${repository}.git`);
  for (const path of ['install/linux.sh', 'install/macos.sh', 'install/windows.ps1']) {
    const source = await read(path);
    const configured = source.match(/(?:REPO|\$Repository)\s*=\s*'([^']+)'/)?.[1];
    assert.equal(configured, REPOSITORY, path);
  }
});

test('published install instructions and package metadata use the canonical repository', async () => {
  for (const path of ['README.md', 'docs/getting-started.md']) {
    assert.ok((await read(path)).includes(`git clone ${repository}.git swarmcrews`), path);
  }
  const readme = await read('README.md');
  for (const script of ['linux.sh', 'macos.sh', 'windows.ps1']) {
    assert.ok(readme.includes(`${raw}${script}`), `README download for ${script}`);
  }
  assert.ok((await read('docs/installing.md')).includes(`${raw}linux.sh`));
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.homepage, `${repository}#readme`);
  assert.equal(pkg.bugs.url, `${repository}/issues`);
  assert.equal(pkg.repository.url, `git+${repository}.git`);
});
