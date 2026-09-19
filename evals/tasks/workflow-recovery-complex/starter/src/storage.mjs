import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function load(directory) {
  const file = join(directory, 'state.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
export function save(directory, state) {
  writeFileSync(join(directory, 'state.json'), JSON.stringify(state));
}
