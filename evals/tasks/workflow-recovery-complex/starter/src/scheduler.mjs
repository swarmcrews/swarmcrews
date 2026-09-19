export function transition(previous, request) {
  if (request.action === 'init') return {
    state: {jobs: request.jobs.map(job => ({...job, status: 'ready', attempt: 0,
      availableAt: 0, owner: null, token: null, leaseUntil: null})), effects: []},
    output: {ok: true},
  };
  if (!previous) throw Error('missing state');
  if (request.action === 'inspect') return {state: previous, output: previous};
  // The legacy prototype only claims jobs; implement the complete protocol.
  if (request.action === 'claim') {
    const claims = previous.jobs.filter(job => job.status === 'ready').slice(0, request.limit);
    for (const job of claims) Object.assign(job, {status: 'leased', attempt: job.attempt + 1,
      owner: request.worker, token: `${job.id}:1`, leaseUntil: request.now + request.leaseMs});
    return {state: previous, output: {claims: claims.map(({id, token, value}) => ({id, token, value}))}};
  }
  return {state: previous, output: {accepted: false}};
}
