const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value);
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, required, optional = []) {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw Error('invalid fields');
}
export function validate(r) {
  const fields = {init: ['jobs'], claim: ['worker','limit','leaseMs'],
    settle: ['id','worker','token','ok','retryMs'], cancel: ['id'], inspect: []};
  if (!object(r) || !Object.hasOwn(fields, r.action)) throw Error('invalid action');
  keys(r, ['directory','now','action', ...fields[r.action]], r.action === 'inspect' ? [] : ['crashAt']);
  if (typeof r.directory !== 'string' || !r.directory || !integer(r.now, 0)) throw Error('invalid base');
  if (Object.hasOwn(r, 'crashAt') && !['before-rename','after-rename'].includes(r.crashAt)) throw Error('invalid crash');
  if (r.action === 'init') {
    if (!Array.isArray(r.jobs)) throw Error('invalid jobs');
    const ids = new Set();
    for (const job of r.jobs) {
      keys(job, ['id','deps','value','maxAttempts']);
      if (!id(job.id) || ids.has(job.id) || !Number.isSafeInteger(job.value) ||
          !integer(job.maxAttempts, 1, 8) || !Array.isArray(job.deps) ||
          job.deps.some(dep => !id(dep)) || new Set(job.deps).size !== job.deps.length) throw Error('invalid job');
      ids.add(job.id);
    }
    const graph = new Map(r.jobs.map(job => [job.id, job.deps]));
    const done = new Set(), visiting = new Set();
    function visit(key) {
      if (done.has(key)) return;
      if (!ids.has(key) || visiting.has(key)) throw Error('invalid dependency graph');
      visiting.add(key);
      for (const dep of graph.get(key)) visit(dep);
      visiting.delete(key); done.add(key);
    }
    for (const key of ids) visit(key);
  }
  if (['claim','settle'].includes(r.action) && !id(r.worker)) throw Error('invalid worker');
  if (['cancel','settle'].includes(r.action) && !id(r.id)) throw Error('invalid id');
  if (r.action === 'claim' && (!integer(r.limit, 1, 8) || !integer(r.leaseMs, 1, 1000))) throw Error('invalid claim');
  if (r.action === 'settle' && (typeof r.token !== 'string' || typeof r.ok !== 'boolean' ||
      !integer(r.retryMs, 1, 1000))) throw Error('invalid settlement');
}
