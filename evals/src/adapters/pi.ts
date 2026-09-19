import type { AdapterConfig, CapabilityReport, ExecutionSnapshot, ParticipantRunSpec, RunEvent, RunHandle } from '../../schemas/index.js';
import type { CollectedExecution, ExecutionAdapter, StopReason, StopReceipt } from '../core/contracts.js';
import { UsageLedger } from '../telemetry/usage.js';
import { report, type PiProcessLauncher, type ProcessRun } from './protocol.js';
import { piIsolationFlags } from './pi-process.js';
import { resolveTreatment } from './treatment.js';

function configuration(settings: Record<string, unknown>) {
  resolveTreatment(settings);
  if (typeof settings.model !== 'string' || !/^[a-zA-Z0-9_-]+\/[^\s:*?]+$/.test(settings.model)) {
    throw new Error('pi-raw requires an explicit provider/model ID (no patterns or thinking suffix)');
  }
  if (settings.taskGraphExperiments !== undefined || settings.graphMinimumNodes !== undefined) throw new Error('pi-raw does not support graph treatments');
  return { model: settings.model, reasoningEffort: settings.reasoningEffort as string | undefined };
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export class PiRawAdapter implements ExecutionAdapter {
  readonly id = 'pi-raw';
  readonly version = '1.0.0';
  #byKey = new Map<string, RunHandle>();
  #byHandle = new Map<string, ProcessRun>();
  constructor(private readonly launcher: PiProcessLauncher) {}

  async preflight(config: AdapterConfig): Promise<CapabilityReport> {
    configuration(config.settings);
    const probe = await this.launcher.probe();
    const has = (...flags: string[]) => flags.every(flag => !probe.missingFlags.includes(flag));
    const caps = { direct_executable: true, fresh_state: has(...piIsolationFlags),
      json_events: has('--mode', '--print'), delegation_disabled: has('--no-extensions', '--tools'),
      reconnect: true, workspace_collection: true, stop_descendants: true, usage_export: has('--mode'), filesystem_sandbox: false };
    const missing = config.requiredCapabilities.filter(key => !caps[key as keyof typeof caps]);
    return report(this.id, this.version, !probe.missingFlags.length && !missing.length, caps,
      [...probe.missingFlags.map(flag => `missing Pi flag: ${flag}`), ...missing.map(key => `missing capability: ${key}`)],
      [`${probe.executable} ${probe.version} sha256:${probe.binaryDigest}`,
        'Fresh Pi config, no saved session or discovered resources; only built-in coding tools are enabled.',
        'Local Pi has no filesystem sandbox. Reconnect reattaches the evaluator to its durable supervisor; it does not resume a killed model session.']);
  }

  async start(run: ParticipantRunSpec): Promise<RunHandle> {
    const config = configuration(run.configuration);
    const existing = this.#byKey.get(run.idempotencyKey);
    if (existing) return existing;
    const process = await this.launcher.launch({ run, args: ['--mode', 'json', '--print', ...piIsolationFlags,
      '--tools', 'read,bash,edit,write,grep,find,ls', '--model', config.model,
      ...(config.reasoningEffort ? ['--thinking', config.reasoningEffort] : [])], environment: {} });
    const handle: RunHandle = { schemaVersion: 1, adapterId: this.id, handleId: process.id, runId: run.runId, createdAt: process.createdAt ?? new Date().toISOString() };
    this.#byKey.set(run.idempotencyKey, handle);
    this.#byHandle.set(handle.handleId, process);
    return handle;
  }

  async *observe(handle: RunHandle, afterSequence = 0): AsyncIterable<RunEvent> {
    const process = this.process(handle);
    const ledger = new UsageLedger();
    let sequence = 0;
    let turn = 0;
    let missingUsage = false;
    const event = (type: RunEvent['type'], payload: Record<string, unknown>): RunEvent => ({
      schemaVersion: 1, eventId: `${handle.runId}:${sequence}`, experimentId: 'external', runId: handle.runId,
      sequence, observedAt: new Date().toISOString(), providerTimestamp: null, adapterId: this.id,
      participantId: handle.runId, sessionId: handle.handleId, turnId: `turn-${turn}`, type, payload,
    });
    for await (const raw of process.events) {
      const payload = record(raw) ?? { type: 'error', message: 'invalid Pi event', raw };
      sequence++;
      if (payload.type === 'turn_start') turn++;
      let type: RunEvent['type'] = payload.type === 'error' ? 'error' : 'lifecycle';
      let normalizedUsage;
      const message = record(payload.message);
      const usage = record(message?.usage);
      // turn_end and agent_end repeat these messages. Account only authoritative message_end records.
      if (payload.type === 'message_end' && message?.role === 'assistant') {
        if (['error', 'aborted', 'length'].includes(String(message.stopReason))) type = 'error';
        if (usage && typeof usage.input === 'number' && typeof usage.output === 'number') {
          const incomplete = ['cacheRead', 'cacheWrite'].some(key => typeof usage[key] !== 'number');
          ledger.ingest({ sourceId: `message-${sequence}`, participantId: handle.runId, turnId: `turn-${turn}`,
            kind: 'turn_snapshot', semantics: 'pi_raw', input: usage.input, output: usage.output,
            cacheRead: usage.cacheRead as number | undefined, cacheWrite: usage.cacheWrite as number | undefined,
            reasoning: usage.reasoning as number | undefined,
            coverage: incomplete ? 'partial' : 'complete', coverageReasons: incomplete ? ['Pi cache usage is incomplete'] : [],
          });
          normalizedUsage = ledger.aggregate([handle.runId]).usage;
          type = 'usage';
        } else missingUsage = true;
      }
      if (sequence > afterSequence) yield event(type, { ...payload, ...(normalizedUsage ? { normalizedUsage } : {}) });
    }
    const outcome = (await process.inspect()).outcome;
    const usage = ledger.aggregate([handle.runId]).usage;
    if ((outcome !== 'completed' || missingUsage) && usage && ++sequence > afterSequence) {
      yield event('usage', { usage: { ...usage, coverage: 'partial', coverageReasons: [...usage.coverageReasons,
        ...(missingUsage ? ['missing usage for Pi assistant message'] : []),
        ...(outcome !== 'completed' ? [`terminal outcome ${outcome}; in-flight usage may be unreported`] : []),
      ] } });
    }
  }

  async inspect(handle: RunHandle): Promise<ExecutionSnapshot> {
    const state = await this.process(handle).inspect();
    return { schemaVersion: 1, handle, state: state.terminal ? 'terminal' : 'running', terminalOutcome: state.outcome,
      participants: [{ id: handle.runId, parentId: null, state: state.terminal ? 'terminal' : 'running', terminal: state.terminal }], observedAt: new Date().toISOString() };
  }
  async stop(handle: RunHandle, reason: StopReason): Promise<StopReceipt> {
    const accepted = await this.process(handle).stop(reason);
    return { schemaVersion: 1, handle, reason, accepted, stoppedAt: new Date().toISOString(), descendantsAccountedFor: accepted };
  }
  async collect(handle: RunHandle): Promise<CollectedExecution> {
    return { schemaVersion: 1, handle, artifacts: await this.process(handle).collect(),
      provenance: { executable: 'pi', mode: 'raw', direct: true, protocolAdherence: (await this.process(handle).inspect()).outcome === 'completed' ? 'valid' : 'unverified' },
      usageCoverage: 'partial', logTruncated: false };
  }
  private process(handle: RunHandle): ProcessRun { return this.#byHandle.get(handle.handleId) ?? this.launcher.reconnect(handle.handleId); }
}
