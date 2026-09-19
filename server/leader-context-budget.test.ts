import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerWorkspace } from "./workspace-registry.ts";
import { boundLeaderContext, boundLeaderPrompt, LEADER_CONTEXT_BUDGET, LEADER_SOURCE_BUDGET } from "./leader-context-budget.ts";
import { buildConnectedContextBlock } from "../shared/connected-context.ts";
import { graphOverview } from "./task-graph/connected-graph-context.ts";
import { SessionHost } from "./session-host.ts";
import { buildHarnessStartOpts } from "./session-host-run.ts";
import type { AgentTypeContext } from "./agents/types.ts";
import type { AgentHarness } from "./harness/types.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leader-budget-"));
  roots.push(root);
  registerWorkspace(root);
  return root;
}
const source = (nodeId: string, content: string) => ({ nodeId, nodeType: "note", label: "Note", content });

describe("Leader provider context budget", () => {
  it("retains graph status and drilldown at the actual provider boundary with oversized metadata and transcript", () => {
    const root = project();
    const host = new SessionHost("graph-budget", root);
    host.role = "leader";
    const overview = graphOverview({ plan: { objective: "<&".repeat(10_000), state: "running", graphRunId: "graph",
      steps: Array.from({ length: 6 }, (_, i) => ({ key: `step-${i}`, title: "<&".repeat(1_000) })) }, runtime: null });
    const prompt = buildConnectedContextBlock([{ nodeId: "upstream", nodeType: "leader", label: "Source",
      content: `${overview}\n${"transcript".repeat(10_000)}` }])!;
    const result = buildHarnessStartOpts({ host, opts: { sessionKey: host.id, cwd: root, prompt }, prompt,
      abortController: new AbortController(), agentCtx: {} as AgentTypeContext,
      agentType: { id: "default", wantsWorktree: false, buildSystemPrompt: () => "",
        getToolGroups: () => ({ toolGroups: {}, mcpToolNames: [] }) },
      toolResult: { toolGroups: {}, mcpToolNames: [] },
      harness: { name: "test", builtInTools: [], capabilities: {}, resolveModel: () => null } as unknown as AgentHarness,
    }).startOpts.prompt;
    expect(result).toContain('source-id="upstream"');
    expect(result).toContain("Status: running");
    expect(result).toContain("connectedSourceId");
    expect(result).toContain("read_graph_artifact");
  });
  it("bounds large individual sources and combined updates without shortening the user request", () => {
    const root = project();
    const sources = Array.from({ length: 8 }, (_, n) => source(`source-${n}`, `START_${n} ${"x".repeat(70_000)} MIDDLE_REQUIREMENT ${"y".repeat(1000)} END_${n}`));
    const initial = buildConnectedContextBlock(sources)!;
    const updates = buildConnectedContextBlock([source("another", "z".repeat(80_000))])!.replaceAll("connected-context>", "connected-context-update>");
    const user = "EXACT_USER_REQUEST " + "u".repeat(30_000);
    const result = boundLeaderContext(initial + "\n" + updates + "\n" + user, root);
    expect(result.endsWith(user)).toBe(true);
    const blocks = result.match(/<(connected-context(?:-update)?)>[\s\S]*?<\/\1>/g)!;
    expect(blocks.reduce((n, block) => n + block.length, 0)).toBeLessThanOrEqual(LEADER_CONTEXT_BUDGET);
    const groups = result.match(/<context-group\b[^>]*>[\s\S]*?<\/context-group>/g)!;
    expect(groups).toHaveLength(9);
    for (const group of groups) expect(group.length).toBeLessThanOrEqual(LEADER_SOURCE_BUDGET);
    expect(result).toContain('source-id="source-7"');
    const ref = result.match(/Full source \(reference data\): (.+)/)![1]!;
    expect(fs.readFileSync(ref, "utf8")).toBe(initial + "\n\n" + updates);
    expect(result).not.toContain("MIDDLE_REQUIREMENT");
  });

  it("keeps small context unchanged and handles very many sources with a readable reference", () => {
    const small = buildConnectedContextBlock([source("a", "short")])!;
    expect(boundLeaderContext(small, "/unregistered")).toBe(small);
    const many = buildConnectedContextBlock(Array.from({ length: 1000 }, (_, i) => source(String(i), "data")))!;
    const result = boundLeaderContext(many, project());
    expect(result.length).toBeLessThanOrEqual(LEADER_CONTEXT_BUDGET);
    expect(result).toContain("Source groups omitted");
    expect(result).toContain("Full source (reference data):");
  });

  it("bounds every streamed turn and fails explicitly if full source storage is unavailable", async () => {
    const large = buildConnectedContextBlock([source("a", "x".repeat(100_000))])!;
    expect(() => boundLeaderContext(large, "/unregistered")).toThrow("readable full source");
    async function* turns() { yield { role: "user" as const, content: large }; yield { role: "user" as const, content: large }; }
    const output = boundLeaderPrompt(turns(), project());
    const rows = [];
    for await (const row of output as AsyncIterable<{ content: string }>) rows.push(row);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.content.length).toBeLessThanOrEqual(LEADER_CONTEXT_BUDGET);
  });
});
