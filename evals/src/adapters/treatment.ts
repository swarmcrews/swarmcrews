/** Protocol treatment contract, deliberately independent of application imports. */
const infrastructure = new Set(['executable','stateRoot','appRoot','codexExecutable','isolation','profile','execution','experimentId','imageDigest','networkPolicy']);
export function resolveTreatment(settings:Record<string,unknown>) {
  for (const key of Object.keys(settings)) if (!infrastructure.has(key) && !['model','reasoningEffort','taskGraphExperiments','graphMinimumNodes'].includes(key)) throw new Error(`unsupported treatment setting: ${key}`);
  if (settings.graphMinimumNodes !== undefined && settings.graphMinimumNodes !== 1 && settings.graphMinimumNodes !== 2) throw new Error('graphMinimumNodes must be 1 or 2');
  const flags = settings.taskGraphExperiments;
  if (flags !== undefined) {
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) throw new Error('taskGraphExperiments must be an object');
    for (const [key, value] of Object.entries(flags)) {
      if (!['decisionContinuations','semanticPartitioning','questionGraph'].includes(key) || typeof value !== 'boolean') throw new Error(`unsupported taskGraphExperiments setting: ${key}`);
    }
  }
  if (settings.model !== undefined && (typeof settings.model !== 'string' || !settings.model.trim())) throw new Error('model must be a nonempty string');
  const effort=settings.reasoningEffort;
  if (effort !== undefined && (typeof effort !== 'string' || !['low','medium','high','xhigh','max'].includes(effort))) throw new Error(`unsupported reasoningEffort: ${String(effort)}`);
  return { ...(settings.model === undefined ? {} : {model:settings.model as string}), ...(effort === undefined ? {} : {thinkingConfig:{enabled:true,effort:effort as string,display:'summarized'}}) };
}
