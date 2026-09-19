import { existsSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync } from 'node:fs';
import { join } from 'node:path';
export function load(directory) {
  const file = join(directory, 'state.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
export function save(directory, state, crashAt) {
  const file = join(directory, 'state.json');
  const temporary = join(directory, `snapshot-${process.pid}.tmp`);
  const fd = openSync(temporary, 'wx');
  try { writeFileSync(fd, JSON.stringify(state)); fsyncSync(fd); }
  finally { closeSync(fd); }
  if (crashAt === 'before-rename') process.kill(process.pid, 'SIGKILL');
  renameSync(temporary, file);
  const parent = openSync(directory, 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
  if (crashAt === 'after-rename') process.kill(process.pid, 'SIGKILL');
}
