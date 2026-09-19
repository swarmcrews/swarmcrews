import { describe, expect, it } from "vitest";
import {
  LEGACY_PLANNING_PROMPT,
  CLAUDE_LEADER_BUILT_IN_TOOLS,
  TASK_GRAPH_LEADER_TOOL_NAMES,
  LEADER_PROMPT_CORE,
  TASK_GRAPH_PLANNING_PROMPT,
  buildLeaderPromptFeatures,
  buildLeaderCapabilityInventory,
  composeLeaderPrompt,
  decodeLeaderPromptCustomization,
  encodeLeaderPromptCustomization,
  isLeaderPromptCustomizationEnvelope,
} from "./leader-prompt.ts";
import { getLeaderProcedure } from "./leader-procedures.ts";
import { TASK_GRAPH_PATTERN_CATALOG } from "./task-graph-patterns.ts";

describe("leader prompt composition", () => {
  it("injects planning features from a typed registry", () => {
    expect(buildLeaderPromptFeatures(["task_graph_planning"]))
      .toEqual([TASK_GRAPH_PLANNING_PROMPT]);
    expect(buildLeaderPromptFeatures(["legacy_planning"]))
      .toEqual([LEGACY_PLANNING_PROMPT]);
    expect(buildLeaderPromptFeatures([
      "task_graph_planning", "task_graph_planning",
    ])).toEqual([TASK_GRAPH_PLANNING_PROMPT]);
  });

  it("keeps the stable core first and the volatile system-model addendum last", () => {
    const prompt = composeLeaderPrompt({
      builtInTools: ["Read"],
      registeredToolNames: ["plan_task"],
      roleSystemAddendum: "ROLE SYSTEM",
      skillsAddendum: "SKILLS",
      userPrefix: "USER PREFIX",
      systemModelAddendum: "VOLATILE MODEL",
    });

    expect(prompt.startsWith(LEADER_PROMPT_CORE)).toBe(true);
    for (const marker of ["plan_task", "ROLE SYSTEM", "SKILLS", "USER PREFIX"]) {
      expect(prompt).toContain(marker);
    }
    expect(prompt.indexOf("plan_task")).toBeLessThan(prompt.indexOf("SKILLS"));
    expect(prompt.indexOf("ROLE SYSTEM")).toBeLessThan(prompt.indexOf("SKILLS"));
    expect(prompt.indexOf("SKILLS")).toBeLessThan(prompt.indexOf("USER PREFIX"));
    expect(prompt.endsWith("VOLATILE MODEL")).toBe(true);
  });

  it("documents every supplied registered tool name", () => {
    const names = [
      "message_task",
      "cancel_task",
      "checkpoint_session",
      "load_subskill",
      "update_project_context",
      "publish_html",
      "wait_and_continue",
      "unknown_future_tool",
    ];
    const inventory = buildLeaderCapabilityInventory({
      builtInTools: [],
      registeredToolNames: names,
    });

    for (const name of names) expect(inventory).toContain(name);
    expect(inventory).toContain("callable schemas define arguments and behavior");
  });

  it("defaults to direct execution and makes graph use benefit-driven or user-requested", () => {
    expect(LEADER_PROMPT_CORE).toContain("Execute tasks directly by default");
    expect(LEADER_PROMPT_CORE).not.toContain("Delegate broad exploration");
    expect(TASK_GRAPH_PLANNING_PROMPT).toContain("Execute tasks directly by default, including substantial, tightly coupled implementation");
    expect(TASK_GRAPH_PLANNING_PROMPT).toContain("complicated, multi-model, or parallelizable work");
    expect(TASK_GRAPH_PLANNING_PROMPT).toContain("outweigh coordination overhead");
    expect(TASK_GRAPH_PLANNING_PROMPT).toContain("Otherwise, process the task yourself unless the user explicitly asks for a graph");
    expect(TASK_GRAPH_PLANNING_PROMPT).toContain("Honor explicit Graph/Crew requests, including `/graph` and `/crew`");
    expect(TASK_GRAPH_PLANNING_PROMPT).toContain("review and start settings");
    expect(TASK_GRAPH_PLANNING_PROMPT).toContain("When delegating work to Minions, submit a graph plan");
    expect(TASK_GRAPH_PLANNING_PROMPT).toContain("server scheduler own admission and child allocation");
    for (const text of [TASK_GRAPH_PLANNING_PROMPT, getLeaderProcedure("graph_authoring")!.body]) {
      expect(text).not.toMatch(/always enabled|standard Minion execution path|Leaders may still execute/);
      expect(text).toContain("Do not create a single-step graph merely to hand off work you can complete directly");
    }
    expect(LEGACY_PLANNING_PROMPT).not.toContain("Canonical Leaders always use Task Graph");
  });

  it("surfaces a compact set of catalog-backed graph strategies before authoring", () => {
    for (const id of ["p01.pipeline", "p02.fork_join", "p03.static_scatter_gather",
      "p07.independent_verification", "p08.generate_critique_revise_verify", "p13.dialectic"]) {
      expect(TASK_GRAPH_PATTERN_CATALOG.some(pattern => pattern.id === id)).toBe(true);
      expect(TASK_GRAPH_PLANNING_PROMPT).toContain(id);
    }
    expect(TASK_GRAPH_PLANNING_PROMPT).toContain("Different models should add complementary capabilities or perspectives");
  });

  it("scopes experimental lifecycle guidance to chosen graphs rather than requiring one", () => {
    const prompt = composeLeaderPrompt({
      builtInTools: ["read", "edit"], registeredToolNames: [],
      taskGraphExperiments: { decisionContinuations: true, semanticPartitioning: true, questionGraph: true },
    });
    expect(prompt).toContain("The following guidance applies only when using a graph; it does not require creating one");
    expect(prompt).toContain("For graph work, make the next decision explicit");
    expect(prompt).toContain("if children remain active call wait_and_continue");
  });

  it("retrieves author-time guidance without injecting every graph pattern", () => {
    const guidance = getLeaderProcedure("graph_authoring")!.body;
    expect(TASK_GRAPH_PLANNING_PROMPT).toContain("lifecycle procedure index");
    expect(TASK_GRAPH_PLANNING_PROMPT).not.toContain("sourceOutput");
    expect(guidance).toMatch(/choose the problem model before authoring topology/i);
    expect(guidance).toContain('taskKind: "partitioned_batch"');
    expect(guidance).toContain('taskKind: "draft_refinement"');
    expect(guidance).toMatch(/pattern metadata.*advisory provenance/i);
    for (const pattern of TASK_GRAPH_PATTERN_CATALOG) {
      expect(guidance).toContain(pattern.id);
      expect(guidance).toContain(`Use when ${pattern.useWhen}`);
      expect(guidance).toContain(`Avoid when ${pattern.avoidWhen}`);
    }
  });

  it("retrieves the complete artifact dependency contract", () => {
    const guidance = getLeaderProcedure("graph_authoring")!.body;
    expect(guidance).toMatch(/sourceOutput.*producer.*outputSchemas/i);
    expect(guidance).toMatch(/targetInput.*consumer.*inputBindings/i);
    expect(guidance).toMatch(/kind \`control\`.*bindings null/i);
  });

  it("retrieves Work Packet closure requirements at reconciliation", () => {
    const guidance = getLeaderProcedure("reconciliation")!.body;
    expect(guidance).toMatch(/terminal graph run completes execution but does not close the packet/i);
    expect(guidance).toMatch(/stable actual diff/i);
    expect(guidance).toMatch(/canonical model update.*no-change assessment/i);
  });

  it("defines all three continuity tags without conflating restart and continuation", () => {
    expect(LEADER_PROMPT_CORE).toContain("<previous-session-context>");
    expect(LEADER_PROMPT_CORE).toContain("<session-continuation>");
    expect(LEADER_PROMPT_CORE).toContain("<context-window-recovery>");
    expect(LEADER_PROMPT_CORE).toMatch(/session-continuation[\s\S]*Do not re-register/i);
    expect(LEADER_PROMPT_CORE).toMatch(/previous-session-context[\s\S]*re-register/i);
  });

  it("defines session names as durable, concise purpose labels", () => {
    expect(LEADER_PROMPT_CORE).toContain("## Session Naming");
    expect(LEADER_PROMPT_CORE).toMatch(/durable label[\s\S]*overall objective/i);
    expect(LEADER_PROMPT_CORE).toMatch(/3–6 words[\s\S]*concrete purpose/i);
    expect(LEADER_PROMPT_CORE).toMatch(/Keep the name stable[\s\S]*first leader-selected name is canonical/i);
    expect(LEADER_PROMPT_CORE).toContain("Working on tests");
    expect(LEADER_PROMPT_CORE).toContain("Harden session naming workflow");
  });

  it("round-trips only the user prefix from the structured client preview", () => {
    const wire = encodeLeaderPromptCustomization({
      promptPrefix: "  User guidance  ",
      skillsAddendum: "FROZEN SKILL INSTRUCTIONS",
    });
    expect(wire).toContain("FROZEN SKILL INSTRUCTIONS");
    expect(isLeaderPromptCustomizationEnvelope(wire)).toBe(true);
    expect(isLeaderPromptCustomizationEnvelope("full client prompt")).toBe(false);
    expect(decodeLeaderPromptCustomization(wire)).toEqual({
      promptPrefix: "User guidance",
      skillsAddendum: "FROZEN SKILL INSTRUCTIONS",
    });
    expect(decodeLeaderPromptCustomization("  raw prefix  ")).toEqual({
      promptPrefix: "raw prefix",
      skillsAddendum: "",
    });
  });
});

it("keeps the baseline compact with every capability and one canonical naming instruction", () => {
  const prompt = composeLeaderPrompt({ builtInTools: CLAUDE_LEADER_BUILT_IN_TOOLS,
    registeredToolNames: TASK_GRAPH_LEADER_TOOL_NAMES });
  expect(prompt.length).toBeLessThan(6500);
  const inventory = buildLeaderCapabilityInventory({ builtInTools: [],
    registeredToolNames: [...TASK_GRAPH_LEADER_TOOL_NAMES, ...TASK_GRAPH_LEADER_TOOL_NAMES] });
  for (const name of TASK_GRAPH_LEADER_TOOL_NAMES) expect(inventory.split(`**${name}**`)).toHaveLength(2);
  expect(prompt.match(/call `set_task_name` once/g)).toHaveLength(1);
  expect(prompt).toContain("observable acceptance criteria");
  expect(prompt).toContain("Only pending form IDs accept answers");
  expect(prompt).toContain("cannot remove provider instructions or permissions");
  expect(prompt).toContain("Load the relevant procedure before entering its phase");
  expect(prompt).toContain("source-id/version");
});
