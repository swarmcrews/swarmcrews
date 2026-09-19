# Workflow recovery evolution experiment

Default-off runtime treatments are available as `experiments-000` through
`experiments-111` (bits: decision continuations, semantic partitioning, question
graph). They share the public task prompt and record requested/observed flags.
See [configuration, prompt coverage, and A/B instructions](../../../docs/features/task-graph-experiments.md).

One task: implement the dependency-free CLI in
[the public contract](../../tasks/workflow-recovery-complex/prompt.md).
DAG scheduling, worker fencing, retry backoff, fixed-point cancellation and atomic
persistence interact across four existing modules. Each request starts a fresh
process. A private seven-criterion grader checks outputs, snapshot contents,
invalid-request byte preservation, and real SIGKILL crash checkpoints.

This is a local development experiment, not a controlled benchmark claim.
Participant sandboxes do not hide the host filesystem. Seeds change job IDs and
values; they are **not independent tasks or new semantic test distributions**.
Fresh confirmation measures repeatability on this task only. Process-death tests
do not establish physical power-loss safety or attest fsync system calls.

## Validate before paying for runs

From the repository root:

```sh
pnpm --dir evals build
node evals/dist/src/cli/main.js validate --suite evals/suites/workflow-recovery.json
pnpm --dir evals exec vitest run --config tests/support/vitest.config.ts tests/fixtures/workflow-process.test.ts tests/fixtures/workflow-comparison.test.ts
```

The reference must pass, the starter must fail, and targeted broken references
must be rejected. The candidate never supplies its own grader. Public smoke uses
regular-file stdio to work inside the participant process sandbox.

## Run one immutable attempt

```sh
node evals/experiments/workflow-recovery/run.mjs /absolute/results/root codex-raw baseline development 1
node evals/experiments/workflow-recovery/run.mjs /absolute/results/root minion-single baseline development 1
node evals/experiments/workflow-recovery/run.mjs /absolute/results/root minion-graph baseline development 1
node evals/experiments/workflow-recovery/run.mjs /absolute/results/root minion-graph bounded-parallel development 1
```

Defaults: `gpt-5.6-sol`, medium effort, 2,000,000 observed total tokens (including cached input), 20-minute
wall watchdog, native Codex delegation disabled. `WORKFLOW_EVAL_MODEL` and
`WORKFLOW_EVAL_CODEX` configure the model/executable before creating a results
root. Existing local Codex authentication is copied to private fresh state; no
user config, conversation history or plugins are copied. Provider calls may incur
cost. Do not publish participant auth files or server state.

The first run snapshots the current server/shared source. Dependencies are shared
with the installed checkout, so this is not a hermetic runtime image. Finish the
first initialization before starting another attempt in the same root. Subsequent
runs reject application source drift. Use a new root after runtime changes; rerun
both controls there. A registered attempt ID cannot be overwritten. Run cells
serially with counterbalanced order for confirmation; simultaneous development
pilots are diagnostic only.

Each cell retains registration, prompt, source fingerprints, resolved project
settings, model/session/graph observations, lifecycle events, usage, frozen
submitted source and independent grades. Failed or interrupted registrations
remain in the comparison denominator. Observed model mismatches disqualify a run.

## Evolution policy

The connected Procedural Graph paper's Section 3.3 supplies the useful loop:
retain a checkpoint, diagnose traces, propose one edit, validate it, and retain
rejected edits as negative evidence. Its situational guidance graph is different
from this application's execution DAG. Evolve the **policy that authors and
executes future DAGs**, respecting immutable runtime topology and attempt fences.

1. Calibrate all three modes: raw, one application Minion, and default graph.
   Verify effective model/effort, public feedback, terminal graph, and all-child
   usage before interpreting a timing difference. Preserve calibration failures.
2. Freeze the task and grader. Diagnose development failures by criterion and
   trace boundary: planning, dispatch, implementation, integration, verification,
   and recovery. Include unsuccessful attempts and startup time.
3. Register a candidate hypothesis before launch. Change one mechanism family:
   model/default propagation, topology, context, verification, or recovery. Do not
   mix a task hint into one mode and attribute the gain to runtime machinery.
4. Current topology candidate `bounded-parallel`: two parallel owners (scheduler;
   validation/storage), existing export contracts, leader integration, short
   reports, and public command feedback without an extra reviewer node. Compare
   against default graph to isolate topology, and against direct/single execution
   to establish whether orchestration pays for itself.
5. If a pilot is promising, freeze its policy and run five matched validation
   pairs per control. Require every run to pass all mandatory criteria, complete
   usage accounting, median graph/direct time <= 0.85, median tokens <= 1.25,
   and a one-sided paired sign-test p <= 0.05. A single fast run cannot promote it.
6. Only a validation winner gets five untouched confirmation pairs. Counterbalance
   order, keep the same model and effort, and include all planned runs. Do not tune
   on confirmation outcomes; a changed policy requires a new confirmation cohort.
7. Record accepted and rejected hypotheses with paths to evidence. Failures return
   to the retained policy, not the last failed candidate. A no-improvement result
   is valid evidence: do not weaken the threshold or turn off necessary correctness
   checks to manufacture a win.

```sh
node evals/experiments/workflow-recovery/compare.mjs /absolute/results/root validation codex-raw:baseline minion-graph:bounded-parallel
node evals/experiments/workflow-recovery/compare.mjs /absolute/results/root confirmation minion-single:baseline minion-graph:bounded-parallel
```

`compare.mjs` emits ratios and blockers, writes an inspectable report, and appends
the decision to `decisions.jsonl`. Missing costs remain unknown. It does not launch
paid work or alter application policy automatically. The Leader proposes and runs
the next mutation; the deterministic gate rejects unsupported promotion claims.

## Next hypotheses, selected by evidence

- If authoring/repair dominates: provide a small validated two-owner template and
  stable module-export contracts; measure planning tokens and rejected proposals.
- If child context dominates: compact assignments with exact files and acceptance
  clauses; measure child input tokens and integration failures.
- If verification dominates: use deterministic command feedback, then send only
  observed failures to a bounded repairer. Preserve the independent private grader.
- If task partitioning is too small to amortize graph overhead: keep this task as
  a negative control and test a larger workload separately; do not change this
  task mid-cohort and call it improvement on the same benchmark.

No production topology/prompt change should be promoted from an unconfirmed local
pilot. Model-default correctness fixes can be validated directly with regression
tests, independently of whether graphs outperform direct execution.

Additional registered development variants are `bounded-wake` (rejected: unarmed yield cancels children), `bounded-durable-wait` (arm the durable wait before yielding) and `leader-scheduler` (leader implements scheduler while separate validation/storage children run). See [hypotheses.json](hypotheses.json) for predictions and causal limitations. The latter bundles load balancing with scope/transport guidance; compare an equivalently guided single control before attributing any gain solely to parallel execution.

Generate bounded diagnostics without rereading full histories:

```sh
node evals/experiments/workflow-recovery/trace.mjs /absolute/results/root/runs/CELL_ID
```

This reports observed planning/first-child latency, status polling, graph/artifact calls, per-session usage and node states. Observation timestamps have polling uncertainty.

For completed application-mode cells, `audit-treatment.mjs CELL_DIRECTORY` checks the provider rollout model/effort metadata without exporting messages or credentials. Missing provider evidence remains unavailable; a mismatch disqualifies the cell.
