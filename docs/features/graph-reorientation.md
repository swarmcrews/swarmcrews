# Reorienting long-running graphs

Leaders use an **Observe → Orient → Decide → Act (OODA)** loop to revisit a graph strategy without rewriting its execution history.

Reorientation is a decision checkpoint, not a scheduler state. Loading the `reorientation` lifecycle procedure does not pause children, cancel a run, or submit another graph.

## When to revisit the strategy

Review the strategy when new findings or user guidance invalidate an assumption, failed checks contradict a result, an approach repeats without new information, or a completed episode leaves acceptance obligations unmet. Budget, policy, input and verification blockers also deserve review.

Routine dependency, capacity, retry-backoff and scheduled-delay waits are not strategy failures. A local defect usually needs a local repair rather than a replacement graph.

`get_graph_plan` exposes bounded, advisory `ooda` routing alongside the current proposal and runtime:

- `phase`: whether the next checkpoint is orientation or a proposal decision.
- `signals`: consequential blockers, failed work, unresolved successful-output verification, terminal execution, source drift or missing runtime evidence.
- `reviewRecommended`: whether those signals suggest a strategy review; it is not a command to replan.
- `choices`: continue, integrate, repair, replan or finish as appropriate. Historical and connected read-only inspections offer inspection only.
- `successor`: the inspected proposal revision, next episode number, and whether the run needs explicit cancellation. A null cancellation requirement means the runtime must be inspected first.

Signals consider all runtime nodes, even when the compact response shows only one page. The compact view omits contracts and artifact contents; use `detail=full`, remaining pages and `read_graph_artifact` for the evidence a decision requires. No signal does not mean the strategy is correct, and terminal execution does not establish mission acceptance.

## The decision loop

1. **Observe** the current run identity, revisions, new committed outputs, verification, blockers, budget and remaining obligations.
2. **Orient** against the objective, assumptions and stop condition. Reuse valid prior evidence instead of repeating reconnaissance.
3. **Decide** explicitly. Summarize what changed, what remains, the action, evidence references and the next checkpoint. Do not expose private chain-of-thought.
4. **Act** through existing controls. Continue useful unowned work, integrate outputs, repair the implicated scope, create a bounded successor, or finish after the required checks.

Completion and attention continuations point Leaders at this procedure. For earlier integration or strategy decisions, a Leader can arm `wait_and_continue` with `wake_on="any_terminal"`; use `all_terminal` when all outputs are needed. A timeout is an observation opportunity, not evidence that the strategy failed. Always end the turn after arming the wait; do not poll or sleep.

## Creating a successor

If topology or ownership must change:

1. Inspect the current graph. If it is active, explicitly call `cancel_graph_run` with the exact displayed runtime revision and inspect the cancellation result.
2. Preserve prior plans, committed artifacts and verification history. Reconcile partial writes and ownership before assigning successor writes. Historical artifacts do not automatically satisfy new graph edges; reference and revalidate retained evidence explicitly.
3. Submit the smallest useful successor against the latest `baseProposalRevision`. Record `iteration.strategy="successor_revision"`, a later `episode`, the changed-strategy `reason`, new-evidence or human-guidance `evidenceRefs`, and a bounded `stopCondition`.
4. Use the normal review/start flow. Reorientation does not bypass source checks, explicit approval, admission, ownership or independent verification.

If an episode produces no new information, resolve the concrete blocker rather than generating indefinite successor graphs. At a dialectic checkpoint, prefer the existing revision-fenced `moderate_dialectic` continue/reshape/stop controls when the graph remains viable.
