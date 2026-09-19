import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParticipantRunSpec } from '../../schemas/index.js';
import type { PiProcessLauncher, ProcessRun } from './protocol.js';
import { DurableProcessRun } from './codex-process.js';
import { command, executionCommand, executionDescriptor } from './execution.js';
import { executableFingerprint } from './fingerprint.js';
import { supervisorSource } from './supervisor.js';

export const piIsolationFlags = ['--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve'];
const requiredFlags = ['--mode', '--print', '--model', '--thinking', '--tools', ...piIsolationFlags];
// Authentication is supplied explicitly through provider API-key environment variables.
// User auth.json, settings, packages, extensions and session histories are never copied.
const environmentKeys = ['PATH', 'LANG', 'TMPDIR', 'SYSTEMROOT', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY', 'XAI_API_KEY'];
function providerEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => environmentKeys.includes(entry[0]) && entry[1] !== undefined));
}

export class LocalPiProcessLauncher implements PiProcessLauncher {
  constructor(private readonly executable = 'pi', private readonly stateRoot?: string) {}

  async probe() {
    const root = await mkdtemp(join(tmpdir(), 'eval-pi-probe-'));
    try {
      const options = { cwd: root, env: { ...providerEnvironment(), PI_CODING_AGENT_DIR: join(root, 'agent'), PI_OFFLINE: '1' } };
      const [help, version, binaryDigest] = await Promise.all([
        command(this.executable, [...piIsolationFlags, '--help'], options),
        command(this.executable, ['--version'], options),
        executableFingerprint(this.executable),
      ]);
      return { executable: this.executable, version: version.trim(), binaryDigest, missingFlags: requiredFlags.filter(flag => !help.includes(flag)) };
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  async launch(input: { run: ParticipantRunSpec; args: string[]; environment: Record<string, string> }): Promise<ProcessRun> {
    const execution = executionDescriptor(input.run, this.stateRoot);
    const digest = createHash('sha256').update(input.run.idempotencyKey).digest('hex');
    const id = join(execution.stateRoot, 'pi', digest);
    await mkdir(join(execution.stateRoot, 'pi'), { recursive: true });
    try { await mkdir(id, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return this.reconnect(id); }
    const agentDirectory = execution.kind === 'docker' ? `/tmp/eval-pi-${digest}` : join(id, 'agent');
    if (execution.kind === 'local') await mkdir(agentDirectory, { mode: 0o700 });
    const environment = { ...providerEnvironment(), ...input.environment, PI_CODING_AGENT_DIR: agentDirectory, PI_OFFLINE: '1' };
    // The host PATH must not replace the container's runtime PATH.
    const containerEnvironment = Object.fromEntries(Object.entries(environment).filter(([key]) => !['PATH', 'LANG', 'TMPDIR', 'SYSTEMROOT'].includes(key)));
    const launch = executionCommand(execution, this.executable, input.args, containerEnvironment);
    if (execution.kind === 'docker') launch.args.splice(1, 0, '-i');
    await writeFile(join(id, 'launch.json'), JSON.stringify({ ...launch, cwd: input.run.workspace.mountPath,
      env: environment, stdin: input.run.prompt, createdAt: new Date().toISOString(),
      containerName: execution.containerName, workspace: input.run.workspace.mountPath, requestedModel: input.run.configuration.model,
    }), { mode: 0o600 });
    // An uncertain launch stays claimed; a restarted controller must not launch it twice.
    const supervisor = spawn(process.execPath, ['-e', supervisorSource, id], { detached: true, stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => { supervisor.once('spawn', resolve); supervisor.once('error', reject); });
    supervisor.unref();
    return this.reconnect(id);
  }

  reconnect(id: string): ProcessRun { return new PiProcessRun(id); }
}

class PiProcessRun extends DurableProcessRun {
  override async inspect() {
    const result = await super.inspect();
    if (result.outcome !== 'completed') return result;
    // Pi can report provider failures in its stream while exiting successfully.
    const spec = JSON.parse(await readFile(join(this.id, 'launch.json'), 'utf8'));
    let ended = false;
    let assistant = false;
    let assistantFailed = false;
    try {
      for (const line of (await readFile(join(this.id, 'stdout.jsonl'), 'utf8')).split('\n').filter(Boolean)) {
        const event = JSON.parse(line);
        if (!event || typeof event !== 'object' || typeof event.type !== 'string' || event.type === 'error') throw new Error('invalid Pi stream');
        if (event.type === 'agent_start') ended = false;
        if (event.type === 'agent_end') ended = true;
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          assistant = true;
          ended = false;
          const message = event.message;
          assistantFailed = ['error', 'aborted', 'length'].includes(message.stopReason);
          if (`${message.provider}/${message.model}` !== spec.requestedModel) throw new Error('Pi resolved model mismatch');
        }
      }
      if (!ended || !assistant || assistantFailed) throw new Error('incomplete or failed Pi stream');
    } catch { return { terminal: true, outcome: 'failed' as const }; }
    return result;
  }
}
