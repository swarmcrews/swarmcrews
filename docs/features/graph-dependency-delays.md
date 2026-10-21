# Timed pauses between graph steps

Set `delayMs` on a dependency when creating a graph. For example, the following dependency on a second step waits five minutes after `deploy` succeeds:

```json
{
  "stepKey": "deploy",
  "kind": "control",
  "satisfactionPolicy": "all_success",
  "delayMs": 300000
}
```

This works in `submit_graph_plan` (`steps[].dependsOn[]`) and incremental graph authoring (`upsert_graph_edge`). Durations are integer milliseconds from zero to seven days. Omission or zero keeps immediate dependency eligibility.

- The timer starts when the dependency is satisfied, **not** at submission or graph start. Artifact dependencies wait for committed output and any required verification before starting their delay.
- The scheduler stores an absolute deadline in SQLite. No Minion attempt, executor slot, or active Leader invocation is needed during the pause. The server scheduler must be running to dispatch work; after a restart, it honors elapsed deadlines on recovery.
- Expiry makes the dependency ready. Other dependencies, capacity, ownership reservations, budgets, and graph pause state still control admission. Dispatch can occur on the next scheduler tick, not necessarily at the exact deadline.
- Each dependency has its own timer. All-success joins wait for every required dependency's delay; any-success and quorum joins count only matured dependencies. Optional dependencies do not block admission.
- Failure policies are unchanged. A blocked failure cannot start a success-dependent timer. Skipped failures or all-terminal dependencies start their delay when their existing satisfaction policy permits it, after any pending retries.
- Cancelling the graph prevents downstream dispatch. Pausing it does not stop wall-clock time. Invalidating upstream evidence discards its deadline; new evidence starts a fresh delay. Retrying only the downstream step does not restart an already satisfied upstream delay.
- Leader continuations within the same open primary run preserve the deadline. Sealing/cancelling the owning primary run retains the existing graph cancellation behavior; this is not a detached background-job facility.

The graph review shows configured durations. During execution, waiting tasks show a scheduled release time in the Graph Inspector and work queue. This is a dependency release time, not a promise that an executor will be available then.

Use dependency delays for cooldowns, rate limits, or external settling time. Retry backoff is for retrying failed attempts; Leader waits are for suspending the Leader until another decision is needed.
