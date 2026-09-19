import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AdapterConfig, ParticipantRunSpec, RunEvent } from '../../schemas/index.js';
import { createExternalAdapter, LocalPiProcessLauncher, PiRawAdapter, piIsolationFlags } from '../../src/adapters/index.js';
import { LifecycleRunner } from '../../src/core/runner.js';
import { ResultStore } from '../../src/core/store.js';
import { EventStore } from '../../src/core/events.js';
import { command } from '../../src/adapters/execution.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const model = 'openai/fixture-model';
const usage = { input: 17, output: 5, cacheRead: 4, cacheWrite: 2, totalTokens: 28, cost: { total: 0.01 } };
const message = { role: 'assistant', provider: 'openai', model: 'fixture-model', stopReason: 'stop', usage };
const successfulEvents = [{ type: 'turn_start' }, { type: 'message_end', message },
  { type: 'turn_end', message }, { type: 'agent_end', messages: [message] }];
const emit = (events: unknown[]) => `for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event));`;

async function setup(body = emit(successfulEvents), missingFlag = '') {
  const root = await mkdtemp(join(tmpdir(), 'eval-pi-test-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace');
  const stateRoot = join(root, 'state');
  await mkdir(workspace); await mkdir(stateRoot);
  const executable = join(root, 'fake-pi');
  const flags = ['--mode', '--print', '--model', '--thinking', '--tools', ...piIsolationFlags].filter(flag => flag !== missingFlag);
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log(${JSON.stringify(flags.join(' '))}); process.exit(0); }
if (args.includes('--version')) { console.log('fixture-pi 1'); process.exit(0); }
const prompt = fs.readFileSync(0, 'utf8');
fs.appendFileSync('launches', '1');
fs.writeFileSync('prompt.txt', prompt);
${body}
`, { mode: 0o700 });
  const config: AdapterConfig = { schemaVersion: 1, adapterId: 'pi-raw', settings: { executable, stateRoot, model, reasoningEffort: 'medium', profile: 'local-development' }, requiredCapabilities: [] };
  const run: ParticipantRunSpec = { schemaVersion: 1, runId: 'run', idempotencyKey: 'key', taskId: 'fixture',
    prompt: '@literal prompt\n--model unwanted; $(do-not-run)', workspace: { id: 'workspace', mountPath: workspace },
    limits: { maxTotalTokens: 1000, executionTimeoutMs: 5000, preparationTimeoutMs: 1000, gradingTimeoutMs: 1000 },
    configuration: { ...config.settings, execution: { kind: 'local', workdir: workspace, stateRoot } }, visibleAssets: [] };
  const adapter = createExternalAdapter(config);
  return { root, workspace, stateRoot, executable, config, run, adapter };
}
async function events(adapter: ReturnType<typeof createExternalAdapter>, handle: Awaited<ReturnType<typeof adapter.start>>, after = 0) {
  const result: RunEvent[] = [];
  for await (const event of adapter.observe(handle, after)) result.push(event);
  return result;
}

describe('pi-raw external adapter', () => {
  it('registers a real adapter and probes the required CLI features without generating', async () => {
    const f = await setup();
    expect(f.adapter).toBeInstanceOf(PiRawAdapter);
    expect(await f.adapter.preflight(f.config)).toMatchObject({ adapterId: 'pi-raw', supported: true,
      capabilities: { fresh_state: true, delegation_disabled: true, reconnect: true, filesystem_sandbox: false } });
    await expect(readFile(join(f.workspace, 'launches'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.adapter.preflight({ ...f.config, requiredCapabilities: ['filesystem_sandbox'] })).toMatchObject({ supported: false });
  });

  it('rejects an executable missing isolation flags', async () => {
    const f = await setup('', '--no-extensions');
    expect(await f.adapter.preflight(f.config)).toMatchObject({ supported: false, limitations: ['missing Pi flag: --no-extensions'] });
  });

  it('delivers a seekable prompt for CLI startup in restricted process sandboxes', async () => {
    const f = await setup("if (!fs.fstatSync(0).isFile()) process.exit(3);\n" + emit(successfulEvents));
    const handle = await f.adapter.start(f.run);
    await events(f.adapter, handle);
    expect(await f.adapter.inspect(handle)).toMatchObject({ terminalOutcome: 'completed' });
    expect(await readFile(join(f.workspace, 'prompt.txt'), 'utf8')).toBe(f.run.prompt);
  });

  it('locks a Pi suite through the built CLI registry without a provider call', async () => {
    const f = await setup();
    const suite = join(f.root, 'suite.json');
    const destination = join(f.root, 'plan');
    await writeFile(suite, JSON.stringify({ id: 'pi-smoke', profiles: { development: {
      taskIds: ['pagination-simple'], modes: ['pi-raw'], repetitions: 1, settings: f.config.settings,
    } } }));
    const output = JSON.parse(await command(process.execPath, [resolve('dist/src/cli/main.js'), 'plan', '--suite', suite, '--profile', 'development', '--output', destination]));
    expect(output).toMatchObject({ valid: true, launchCount: 1, paidCalls: false });
    const lock = JSON.parse(await readFile(join(destination, 'experiment.lock.json'), 'utf8'));
    expect(lock.adapterConfigs).toEqual([f.config]);
    expect(lock.capabilities[0]).toMatchObject({ adapterId: 'pi-raw', supported: true });
  });

  it.each(['fixture-model', 'openai/*', 'openai/model:high', ''])('rejects ambiguous model selection %j before launch', async model => {
    const f = await setup();
    await expect(f.adapter.start({ ...f.run, configuration: { ...f.run.configuration, model } })).rejects.toThrow();
    await expect(readFile(join(f.workspace, 'launches'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses fresh state, passes a literal prompt and model/effort, replays and launches only once', async () => {
    vi.stubEnv('PI_CODING_AGENT_DIR', '/untrusted-user-config');
    vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', '/untrusted-user-sessions');
    const f = await setup();
    const handle = await f.adapter.start(f.run);
    expect(await f.adapter.start(f.run)).toEqual(handle);
    const observed = await events(f.adapter, handle);
    expect(observed.filter(event => event.type === 'usage')).toHaveLength(1);
    expect(observed[1].payload.normalizedUsage).toMatchObject({ inputTokensTotal: 23, inputTokensUncached: 17, outputTokensTotal: 5, totalTokens: 28, reportedCostUSD: null });
    expect(observed[1].payload.message).toEqual(message);
    expect(await readFile(join(f.workspace, 'prompt.txt'), 'utf8')).toBe(f.run.prompt);
    const launch = JSON.parse(await readFile(join(handle.handleId, 'launch.json'), 'utf8'));
    expect(launch.args).toEqual(expect.arrayContaining([...piIsolationFlags, '--model', model, '--thinking', 'medium', '--tools', 'read,bash,edit,write,grep,find,ls']));
    expect(launch.env.PI_CODING_AGENT_DIR).toBe(join(handle.handleId, 'agent'));
    expect(launch.env.PI_CODING_AGENT_SESSION_DIR).toBeUndefined();
    expect(launch.stdin).toBe(f.run.prompt);
    const restarted = createExternalAdapter(f.config);
    expect(await restarted.start(f.run)).toEqual(handle);
    expect(await readFile(join(f.workspace, 'launches'), 'utf8')).toBe('1');
    expect(await events(restarted, handle, 1)).toEqual(observed.slice(1).map(event => expect.objectContaining({ sequence: event.sequence, payload: event.payload })));
    expect(await restarted.inspect(handle)).toMatchObject({ state: 'terminal', terminalOutcome: 'completed' });
    expect((await restarted.collect(handle)).artifacts.map(artifact => artifact.path)).toContain('prompt.txt');
  });

  it.each([
    ['provider error', emit([{ type: 'message_end', message: { ...message, stopReason: 'error' } }, { type: 'agent_end' }])],
    ['aborted message', emit([{ type: 'message_end', message: { ...message, stopReason: 'aborted' } }, { type: 'agent_end' }])],
    ['truncated message', emit([{ type: 'message_end', message: { ...message, stopReason: 'length' } }, { type: 'agent_end' }])],
    ['model mismatch', emit([{ type: 'message_end', message: { ...message, model: 'wrong' } }, { type: 'agent_end' }])],
    ['missing completion', emit(successfulEvents.slice(0, 2))],
    ['malformed JSON', `console.log('broken JSON');`],
    ['null event', `console.log('null');`],
    ['nonzero exit', `${emit(successfulEvents)} process.exit(1);`],
  ])('does not report %s as completed', async (_name, body) => {
    const f = await setup(body);
    const handle = await f.adapter.start(f.run);
    const observed = await events(f.adapter, handle);
    expect(await f.adapter.inspect(handle)).toMatchObject({ terminalOutcome: 'failed' });
    const lastUsage = observed.filter(event => event.type === 'usage').at(-1);
    if (lastUsage) expect(lastUsage.payload.usage).toMatchObject({ coverage: 'partial' });
  });

  it('marks missing per-message usage as partial without inventing zero usage', async () => {
    const f = await setup(emit([{ type: 'message_end', message: { ...message, usage: undefined } }, ...successfulEvents]));
    const observed = await events(f.adapter, await f.adapter.start(f.run));
    expect(observed.at(-1)?.payload.usage).toMatchObject({ totalTokens: 28, coverage: 'partial', coverageReasons: ['missing usage for Pi assistant message'] });
  });

  it('accepts a successful retry after a provider error and keeps both usage observations', async () => {
    const f = await setup(emit([{ type: 'message_end', message: { ...message, stopReason: 'error' } }, { type: 'agent_end' }, ...successfulEvents]));
    const handle = await f.adapter.start(f.run);
    const observed = await events(f.adapter, handle);
    expect(await f.adapter.inspect(handle)).toMatchObject({ terminalOutcome: 'completed' });
    expect(observed.filter(event => event.type === 'usage').at(-1)?.payload.normalizedUsage).toMatchObject({ totalTokens: 56 });
  });

  it('enforces aggregate usage through the lifecycle runner and preserves raw Pi records', async () => {
    const f = await setup(emit([...successfulEvents.slice(0, 3), ...successfulEvents]));
    const store = new ResultStore(join(f.root, 'results', 'state.json'));
    const runner = new LifecycleRunner({ experimentId: 'pi-test', aggregateTokenCap: 1000, store,
      events: new EventStore(join(f.root, 'results', 'events.jsonl')) }, f.adapter);
    await runner.start({ cell: { schemaVersion: 1, cellId: 'cell', experimentId: 'pi-test', taskId: 'fixture', adapterId: 'pi-raw', repetition: 0, fixtureSeed: 'seed', status: 'planned' },
      spec: { ...f.run, limits: { ...f.run.limits, maxTotalTokens: 50 } } });
    await runner.drive(f.run.runId);
    expect(await store.getResult(f.run.runId)).toMatchObject({ executionOutcome: 'budget_exceeded', usage: { totalTokens: 56 } });
    const raw = await new EventStore(join(f.root, 'results', 'usage.raw.jsonl')).read();
    expect(raw.map(event => event.payload.message)).toEqual([message, message]);
  });

  it('cancels a stubborn process and its child after controller replacement', async () => {
    const f = await setup(`process.on('SIGTERM', () => {});
const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
console.log(JSON.stringify({ type: 'child', pid: child.pid }));
setInterval(() => {}, 1000);`);
    const handle = await f.adapter.start(f.run);
    cleanups.push(() => f.adapter.stop(handle, 'cancelled'));
    const observer = f.adapter.observe(handle);
    const first = await observer.next();
    const pid = first.value!.payload.pid;
    const restarted = new PiRawAdapter(new LocalPiProcessLauncher(f.executable, f.stateRoot));
    expect(await restarted.stop(handle, 'cancelled')).toMatchObject({ accepted: true, descendantsAccountedFor: true });
    expect(await restarted.inspect(handle)).toMatchObject({ terminalOutcome: 'cancelled' });
    let alive = false;
    try { alive = !(await readFile(`/proc/${pid}/stat`, 'utf8')).includes(') Z '); } catch {}
    expect(alive).toBe(false);
    await observer.return(undefined);
  });
});
