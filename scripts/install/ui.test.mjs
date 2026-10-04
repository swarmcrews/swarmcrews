import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { Terminal, Cancelled, clean, wrap } from './ui.mjs';

test('plain terminal has a branded, narrow, escape-free transcript', () => {
  const output = new PassThrough(); output.columns = 40;
  let text = ''; output.on('data', chunk => { text += chunk; });
  const ui = new Terminal({ input: new PassThrough(), output, env: { NO_COLOR: '1' } });
  ui.header('macOS'); ui.step(2, 'Prepare your workspace');
  ui.row('ok', 'Git', '/a/very-long/path/'.repeat(6));
  ui.note('No system tools will be replaced.');
  assert.match(text, /SWARMCREWS/); assert.match(text, /macOS/);
  assert.match(text, /\[OK\]/); assert.doesNotMatch(text, /\x1b/);
  assert.ok(text.trimEnd().split('\n').every(line => line.length <= 40));
});

test('untrusted terminal controls are removed, long values wrap without loss', () => {
  assert.equal(clean('hello\x1b[2J\rworld\x07'), 'helloworld');
  assert.deepEqual(wrap('a'.repeat(71), 30), ['a'.repeat(30), 'a'.repeat(30), 'a'.repeat(11)]);
});

test('color is optional and disabled for dumb terminals', () => {
  const output = new PassThrough(); output.isTTY = true;
  const ui = new Terminal({ output, env: { TERM: 'dumb' } });
  assert.equal(ui.color, false);
});

test('interactive confirmation defaults to no and handles cancellation without raw-mode leaks', async () => {
  for (const [answer, cancelled] of [['\n', false], ['\u0003', true]]) {
    const input = new PassThrough(); input.isTTY = true;
    const output = new PassThrough(); output.isTTY = true;
    let sent = false;
    output.on('data', chunk => {
      if (!sent && chunk.toString().includes('> ')) { sent = true; queueMicrotask(() => input.write(answer)); }
    });
    const ui = new Terminal({ input, output, env: { NO_COLOR: '1' } });
    if (cancelled) await assert.rejects(ui.confirm('Install?'), Cancelled);
    else assert.equal(await ui.confirm('Install?'), false);
    // Node retains its shared keypress decoder; the prompt's own listener and
    // raw mode must be released before yielding the terminal to a provider.
    assert.equal(input.listenerCount('keypress'), 0);
    assert.notEqual(input.isRaw, true);
  }
});

test('noninteractive prompt fails rather than silently authorizing an action', async () => {
  const ui = new Terminal({ input: new PassThrough(), output: new PassThrough(), env: {} });
  await assert.rejects(ui.confirm('Install?'), /interactive terminal/);
});
