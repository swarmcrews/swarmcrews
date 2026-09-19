import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
export const schemaVersion = 1;
export const taskId = 'workflow-recovery-complex';
export async function build() {
  const files = {};
  for (const name of ['src/index.mjs', 'src/storage.mjs', 'src/validation.mjs', 'src/scheduler.mjs']) {
    files[name] = await readFile(new URL(`./starter/${name}`, import.meta.url), 'utf8');
  }
  files['README.md'] = await readFile(new URL('./prompt.md', import.meta.url), 'utf8');
  files['smoke.mjs'] = await readFile(new URL('./smoke.mjs', import.meta.url), 'utf8');
  return {schemaVersion, taskId, files};
}
export async function materialize({destination}) {
  const fixture = await build();
  for (const [name, content] of Object.entries(fixture.files)) {
    const target = resolve(destination, name);
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, content);
  }
  return fixture;
}
