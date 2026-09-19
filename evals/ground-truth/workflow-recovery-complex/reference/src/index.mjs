import { readFileSync } from 'node:fs';
import { load, save } from './storage.mjs';
import { validate } from './validation.mjs';
import { transition } from './scheduler.mjs';

try {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  validate(request);
  const previous = load(request.directory);
  const {state, output} = transition(previous, request);
  if (request.action !== 'inspect') save(request.directory, state, request.crashAt);
  console.log(JSON.stringify(output));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
