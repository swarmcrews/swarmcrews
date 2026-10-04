import { createInterface } from 'node:readline/promises';

// Transcript-first TUI: no alternate screen, raw mode, hidden cursor or animation.
// Amber comes from assets/swarmcrews-logo.svg; terminal background stays native.
export const clean = value => String(value).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
export function wrap(value, width) {
  const chars = Array.from(clean(value));
  const lines = [];
  const limit = Math.max(1, width);
  while (chars.length > limit) {
    const space = chars.slice(0, limit + 1).lastIndexOf(' ');
    const end = space > 0 ? space : limit;
    lines.push(chars.splice(0, end).join(''));
    if (space > 0) chars.shift();
  }
  if (chars.length) lines.push(chars.join(''));
  return lines.length ? lines : [''];
}
export class Cancelled extends Error {
  constructor() { super('Setup cancelled. Existing files and credentials were preserved.'); }
}
export class Terminal {
  constructor({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
    this.input = input; this.output = output;
    this.color = Boolean(output.isTTY && env.TERM !== 'dumb' && !Object.hasOwn(env, 'NO_COLOR'));
  }
  get width() { return Math.max(20, Math.min(this.output.columns || 80, 88)); }
  ink(text, code = '38;5;214') { return this.color ? `\x1b[${code}m${text}\x1b[0m` : text; }
  line(text = '', code, indent = 0) {
    for (const line of wrap(text, this.width - 4 - indent)) {
      this.output.write(`  ${' '.repeat(indent)}${code ? this.ink(line, code) : line}\n`);
    }
  }
  header(platform) {
    this.line(); this.line('  \\  ^  /', '38;5;214'); this.line('   \\___/   SWARMCREWS', '1;38;5;214');
    this.line(); this.line('ONE TASK. A WHOLE CREW.', '1');
    this.line(`${platform} / guided source installation`);
    this.line('No installer packages. No global Node replacement.');
    this.line('─'.repeat(this.width - 4), '90');
  }
  step(number, title) {
    this.line(); this.line(`${String(number).padStart(2, '0')} / 06   ${title}`, '1;38;5;214'); this.line();
  }
  row(state, label, detail = '') {
    const states = { ok: ['OK', '32'], pending: ['WAIT', '38;5;214'], error: ['FIX', '31'], optional: ['SKIP', '90'] };
    const [mark, color] = states[state] || states.pending;
    this.line(`[${mark}] ${label}`, color);
    if (detail) this.line(detail, undefined, 5);
  }
  note(text) { this.line(text); }
  // Let the terminal soft-wrap commands, preserving one copyable logical line.
  command(text) { this.output.write(`  ${clean(text)}\n`); }
  async ask(label, fallback = '') {
    if (!this.input.isTTY || !this.output.isTTY) throw new Error('An interactive terminal is required. Use --yes --dir PATH --agent NAME (or later).');
    const rl = createInterface({ input: this.input, output: this.output, terminal: true });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    rl.on('SIGINT', cancel); rl.on('close', cancel);
    try {
      this.line(label, '1');
      if (fallback) this.line(`Default: ${fallback}`, '90');
      const answer = await rl.question(this.ink('  > '), { signal: controller.signal });
      return answer.trim() || fallback;
    } catch (error) {
      if (controller.signal.aborted) throw new Cancelled();
      throw error;
    } finally { rl.off('close', cancel); rl.close(); }
  }
  async confirm(label) {
    while (true) {
      const answer = (await this.ask(`${label} [y/N]`, 'n')).toLowerCase();
      if (['y', 'yes'].includes(answer)) return true;
      if (['n', 'no'].includes(answer)) return false;
      this.note('Enter y to approve, or n to leave things unchanged.');
    }
  }
  async choose(label, choices, initial = 0) {
    this.note(label);
    choices.forEach((choice, index) => this.line(`${index + 1}. ${choice.label}`));
    while (true) {
      const answer = await this.ask('Choose a number; Enter keeps the default.', String(initial + 1));
      if (/^\d+$/.test(answer) && choices[Number(answer) - 1]) return choices[Number(answer) - 1].value;
      this.row('error', 'Choose one of the listed numbers.');
    }
  }
}
