# Durable dependency workflow recovery

Complete the dependency-free Node 24+ CLI in `src/`. Run
`node src/index.mjs` with one JSON request on stdin. All calls are serialized,
but a lease holder can report completion after another process reclaims its job.
The caller supplies an existing `directory` and a nonnegative integer `now`.
Never use wall time. Persist only `directory/state.json`; ignore abandoned
temporary snapshots. Do not fetch dependencies or outside implementations.

Every successful request prints one JSON object plus LF and exits 0. Invalid
requests print no stdout, nonempty stderr, exit 2, and leave persisted bytes
unchanged. Unknown fields are invalid at every request/job level. All integer
inputs and resulting arithmetic are safe integers. IDs match `[a-zA-Z0-9_-]{1,40}`.
Malformed JSON is invalid. There is no network and no simultaneous file writer.

Requests share `{directory,now,action,crashAt?}`. `crashAt` is optional and only
valid for mutations: `before-rename` or `after-rename`. A mutation must write and
fsync a temporary combined snapshot, optionally SIGKILL the actual process before
rename, rename over state.json, fsync the directory, and optionally SIGKILL after
rename. Before-rename must preserve the old snapshot; after-rename must expose
the entire new snapshot. This tests process death, not physical power failure.
Even a valid no-op mutation commits and reaches its crash checkpoint.

- `init` adds `jobs`: an array of `{id,deps,value,maxAttempts}`. `deps` is an array
  of distinct job IDs, all present in this batch; no self-dependencies or cycles.
  Jobs may precede their dependencies in input order. IDs must be unique. `value`
  is any safe integer; `maxAttempts` is 1–8. Empty graphs are valid. Init is valid
  only when state.json does not exist. Output `{ok:true}`.
- `claim` adds `worker`, `limit` (1–8), `leaseMs` (1–1000). In original job order,
  return at most limit jobs that are ready with `availableAt <= now`, or leased
  with `leaseUntil <= now`, and whose dependencies are all done. Increment each
  attempt; set status leased, owner worker, leaseUntil now+leaseMs and token
  `id:attempt`. Return `{claims:[{id,token,value}]}`. Reclaiming an expired lease
  consumes another attempt. If already at maxAttempts, mark failed instead and
  continue looking for eligible jobs without consuming limit. No active lease
  can be stolen. A dependency completing later only unlocks its children on a
  subsequent claim call.
- `settle` adds `id`, `worker`, `token`, `ok` (boolean), `retryMs` (1–1000).
  Unknown id is invalid. Accept only the current leased job's owner and token
  with `now < leaseUntil`. Otherwise return `{accepted:false}` with unchanged
  logical state. On accepted success, append exactly one `{jobId,value}` effect,
  mark done, and clear owner/token/lease. On accepted failure at maxAttempts mark
  failed; otherwise mark ready with `availableAt = now + retryMs * 2^(attempt-1)`.
  Return `{accepted:true}`. Retransmissions must not duplicate effects. Failure
  never emits an effect. Values come from the stored job, not from the request.
- `cancel` adds `id`. Unknown id is invalid. Cancel a ready/leased job and clear
  its lease; leave done/failed/cancelled jobs unchanged. Output `{ok:true}`.
- `inspect` has no extra fields and returns the stored snapshot without writing.

After every mutation, recursively mark ready/leased descendants of any failed
or cancelled job cancelled, clearing their leases. This must reach a fixed point
regardless of input order. Terminal jobs never change. Other branches continue.

Snapshot shape is exactly `{jobs,effects}`. Preserve job input order. Each job
contains exactly `{id,deps,value,maxAttempts,status,attempt,availableAt,owner,
token,leaseUntil}`. Initial fields are ready, 0, 0, null, null, null. `availableAt`
changes only after a retryable failure. `attempt` only changes on a claim.
Effects retain successful settlement order. Every action except init requires an
existing valid snapshot (assume snapshots were produced by this CLI). State must
survive a fresh process for every request. Do not change this public contract.

You may edit/add `src/**`. `node smoke.mjs` runs public behavioral checks and
prints precise assertion failures; use additional tests as needed. The submitted
files are `src/**` only. Grading uses independent subprocess tests and reads
persisted bytes; candidate-authored tests cannot change the score.
