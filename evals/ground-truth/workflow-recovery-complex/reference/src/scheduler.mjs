function clear(job, status) {
  Object.assign(job, {status, owner: null, token: null, leaseUntil: null});
}
function propagate(state) {
  let changed;
  do {
    changed = false;
    for (const job of state.jobs) {
      if (['ready','leased'].includes(job.status) && job.deps.some(id =>
        ['failed','cancelled'].includes(state.jobs.find(dep => dep.id === id).status))) {
        clear(job, 'cancelled'); changed = true;
      }
    }
  } while (changed);
}
function safe(value) {
  if (!Number.isSafeInteger(value)) throw Error('integer overflow');
  return value;
}
export function transition(previous, r) {
  if (r.action === 'init') {
    if (previous !== null) throw Error('already initialized');
    return {state: {jobs: r.jobs.map(job => ({...job, status: 'ready', attempt: 0,
      availableAt: 0, owner: null, token: null, leaseUntil: null})), effects: []}, output: {ok: true}};
  }
  if (previous === null) throw Error('missing state');
  const state = structuredClone(previous);
  if (r.action === 'inspect') return {state, output: state};
  let output;
  if (r.action === 'claim') {
    const claims = [];
    for (const job of state.jobs) {
      if (claims.length === r.limit) break;
      const eligible = (job.status === 'ready' && job.availableAt <= r.now) ||
        (job.status === 'leased' && job.leaseUntil <= r.now);
      if (!eligible || !job.deps.every(id => state.jobs.find(dep => dep.id === id).status === 'done')) continue;
      if (job.attempt >= job.maxAttempts) { clear(job, 'failed'); continue; }
      job.attempt++;
      Object.assign(job, {status: 'leased', owner: r.worker,
        token: `${job.id}:${job.attempt}`, leaseUntil: safe(r.now + r.leaseMs)});
      claims.push({id: job.id, token: job.token, value: job.value});
    }
    output = {claims};
  } else {
    const job = state.jobs.find(job => job.id === r.id);
    if (!job) throw Error('unknown job');
    if (r.action === 'cancel') {
      if (['ready','leased'].includes(job.status)) clear(job, 'cancelled');
      output = {ok: true};
    } else {
      const accepted = job.status === 'leased' && job.owner === r.worker &&
        job.token === r.token && r.now < job.leaseUntil;
      if (accepted) {
        if (r.ok) {
          state.effects.push({jobId: job.id, value: job.value});
          clear(job, 'done');
        } else if (job.attempt >= job.maxAttempts) clear(job, 'failed');
        else {
          job.availableAt = safe(r.now + r.retryMs * 2 ** (job.attempt - 1));
          clear(job, 'ready');
        }
      }
      output = {accepted};
    }
  }
  propagate(state);
  return {state, output};
}
