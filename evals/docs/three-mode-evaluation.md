# Standalone Codex, single Minion, and Task Graph evaluation

Status on 2026-09-12: preparation, not measured results. No model participants
have been launched for this experiment. All three selected adapters already exist.
An explicitly adapted Dask workload now reproduces reference success and base
failures. Runner integration and live treatment calibration remain outstanding.

## Treatments

| Arm | Adapter | Execution |
| --- | --- | --- |
| Codex harness only | `codex-raw` | External controller launches `codex exec` directly, in a fresh workspace and Codex home, outside Swarmcrews. |
| Single-agent application proxy | `minion-single` | Dedicated Swarmcrews instance starts one Minion, which implements and verifies the task without delegation. |
| Minion Task Graph | `minion-graph` | Dedicated Swarmcrews instance starts a Leader that authors and executes its own graph, then integrates and verifies outputs. |

The user accepted a single Minion as the proxy for single execution within the
application. Use the existing `minion-single` adapter; no separate Leader adapter
is needed. Report the actual role as Minion. This experiment does not isolate the
cost of the Leader-specific prompt and tool inventory.

Native Codex subagents are disabled in all three arms. Single-Minion application
tools also exclude delegation and graph execution. The graph arm includes its
Leader and every child in aggregate usage.

## Workload and calibration evidence

Use the [existing Dask release-evolution proposal](complex-benchmark-proposal.md):
backend dispatch, array behavior, dataframe groupby/rolling, and CLI/runtime work
provide separate implementation surfaces and a real integration burden.
The participant receives the same requirements in every arm, without a supplied
solution decomposition. Small single-file fixtures are useful telemetry probes
but weak evidence about graph value.

Re-fetched and inspected the pinned
[SWE-EVO dataset](https://huggingface.co/datasets/Fsoft-AIC/SWE-EVO/blob/77310c70d3648d6815f6a7555ecc492bc28c44ec/SWE-EVO/hf_jsonl/test.jsonl):

- Task: `dask__dask_2022.9.2_2022.10.0`.
- Base: `3ef47422b9f830f81562960ef549778819498aa1`.
- Reference: `feb290395bad802486781a5dc695880df1b907cf`.
- Reference patch: 50 files, 29 within the Dask package.
- Dataset lists: 44 FAIL_TO_PASS and 2,861 PASS_TO_PASS IDs. These are declared
  test IDs, not verified executable-test counts. Thirty FAIL_TO_PASS IDs concern
  groupby, so report subsystem coverage as well as the overall fraction.
- Downloaded image:
  `xingyaoww/sweb.eval.x86_64.dask_s_dask-9531@sha256:b067cb26fc09fd8cb8371a6271f19e1357de2d303ddd220a53894cab77f39cce`.
  Verified that `/testbed` is at the specified base commit.

Credential-free reference checks applied both supplied patches in fresh
network-disabled containers. The original image has Python 3.10.14, pandas
2.2.2, and NumPy 1.26.4; the reference cannot collect dataframe tests because
`pandas.core.strings.StringMethods` is absent.

A separate calibration image pins pandas 1.5.3 and NumPy 1.23.5. Full pytest
collection identified 16 dataset IDs that do not match executable IDs: NumPy
alias names differ, and some CSV/Emscripten IDs are truncated. An explicit
`test-id-mapping.json` records each adjustment. Truncated IDs require **all**
matching variants to pass; no declared case is dropped. The 2,905 declared cases
map to 2,908 distinct executable tests. This is a local benchmark adaptation,
not an unmodified SWE-EVO leaderboard run.

The test runner includes the conda environment's bin directory in PATH so
Graphviz resolves, selects mapped cases from the 12 relevant test files, and
retains collection errors using `--continue-on-collection-errors`.

| Calibration | FAIL_TO_PASS declared cases | PASS_TO_PASS declared cases | Executable results |
| --- | --- | --- | --- |
| Reference | 44 passed | 2,861 passed | 2,908 passed; no skips or collection errors |
| Base | 40 failed; 4 missing because `dask.cli` is absent | 2,861 passed | 40 failed, 2,864 passed; one CLI collection error |

The reference and base runs took 118.64 and 107.88 seconds respectively. These
are test calibration durations, not model wall-time measurements; they ran
concurrently and must not be used for an execution-efficiency comparison.

Calibration evidence (public dataset, patches, Dockerfile, probe scripts,
explicit ID mapping, environment inventory, and all calibration logs) is retained
outside the repository and is not required to use the evaluation adapters.
`calibration-summary.json` separates failed, missing, and skipped cases.
`check_validated_oracle.py` and `mapped_probe.py` reproduce the checks inside the
adjusted image `sha256:935d1266a12d827f3abb72dafd581f2975c6b58b3e6680afd74d7930c092f4b9`.
Missing CLI cases remain visible; they are never represented as executed tests.

## Experimental design

1. Integrate the calibrated Dask adaptation into the evaluator fixture/grader
   contract and reject representative subsystem defects. Preserve the explicit
   ID mapping and environment changes as a versioned benchmark adaptation.
2. Perform unmeasured live calibration of all three adapters. Verify actual
   single-Minion role, model/effort on every worker, zero single-arm children, integrated
   graph outputs, cancellation, and complete usage coverage. Keep calibration
   usage and time separate from the measured cohort.
3. Lock one model and reasoning effort across Leaders and workers. The local CLI
   currently selects `gpt-5.6-sol` / `medium`; this is a proposed starting setting,
   not evidence that a participant resolved it. Disable adaptive worker model
   routing and verify observed model identities rather than trusting defaults.
4. Run three repetitions per arm (nine measured runs). Randomize arm order within
   each repetition; execute arms sequentially to reduce local resource contention.
   Use a fresh identical base, prompt, test visibility, machine resources, and
   state for each run. Preserve each outcome, including failed or capped runs.
5. Plan around 60 minutes and 2,000,000 aggregate tokens per run, with at most
   three simultaneous graph workers. These are provisional calibration values,
   not a locked paid plan. Freeze identical final caps before measured execution;
   never raise one arm's cap after observing its result. Include Leader, children,
   reviews, retries, and continuations in the graph cap.
6. Freeze submissions, stop all participants, and grade in separate fresh
   containers. Keep evaluator tests, reference changes, target history and source
   solution links outside participant access. Sanitize release PR references
   identically across prompts and disclose the adaptation.

The current runner does not enforce a profile's `maxGraphChildren` field or pin
every graph worker's model. Those controls still need implementation and live
verification. Its Docker backend supports network `none` only: provider egress
and filesystem separation also remain prerequisites for controlled model runs.
Local development runs may help calibrate adapters but must be labeled exploratory.

## Measurements and interpretation

| Measure | Definition |
| --- | --- |
| Correctness | Full resolution; repaired FAIL_TO_PASS fraction; retained PASS_TO_PASS fraction; subsystem breakdown; missing/skip/error counts. |
| Total tokens | Inclusive input + output, summed across all participants. Cache reads are already part of inclusive input. |
| Input breakdown | Uncached input, cache reads, and cache creation separately. Preserve unknown versus explicit zero. |
| Output | Output total and reasoning subset when available; never add reasoning twice. |
| Wall time | Participant launch through final quiescence, including managed-server startup, planning, integration, retries, and self-verification. |
| Phase timing | Server startup, planning, worker intervals, integration, verification, and waiting when timestamps support attribution. |
| Graph overhead | Leader usage, sum of child usage, retries, tool calls, actual overlap and critical path. Do not call all Leader tokens pure coordination. |
| Quality-adjusted usage | All measured attempt tokens divided by successful runs, including unsuccessful attempts in the numerator. Unknown when telemetry is incomplete; no successes means undefined. |
| Cost | Provider-reported cost where available, otherwise a separately labeled estimate using pinned rates; unavailable is not zero. |

Raw Codex JSONL exposes `turn.completed` usage, as described in
[OpenAI's non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode).
Retain raw events and reconcile cumulative session totals without adding the same
turn twice. Token caps are observed-boundary caps and can overshoot, particularly
when standalone usage only arrives at turn completion. A cancelled run with
unreported in-flight usage cannot support an exact efficiency ratio.

Report each run plus per-arm median and range/IQR. Compare time and tokens at
matched correctness, and show failed-run effort separately. Include graph/single
and single/raw ratios. Graph/single includes both Leader coordination and
delegation costs; single/raw compares the application proxy with standalone Codex.
Plot correctness versus total tokens and correctness versus elapsed time, with
cache and participant breakdowns alongside the graph timeline. Three repetitions
of one task constitute a case study, not a general claim about graph efficiency.

Graph value is supported if it achieves greater correctness at the same budget,
uses fewer tokens at comparable correctness, or delivers a useful elapsed-time
reduction whose additional token cost is made explicit. A faster failing run is
not a win.
