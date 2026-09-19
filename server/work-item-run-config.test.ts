import { describe, expect, it, vi } from "vitest";
import { compatibleResumeId, resolveNewPrimaryRunConfig, resolvePrimaryRunConfig } from "./work-item-run-config.ts";
import * as projectStore from "./project-store.ts";

describe("primary run planning config", () => {
  it("freezes continuation defaults for new iterations without changing legacy resumes", () => {
    const legacyJson = JSON.stringify({ harness: "codex" });
    const legacy = { session_id: "legacy-thread", harness_name: "codex", run_config_json: legacyJson };
    const resumed = resolvePrimaryRunConfig(legacyJson, { prompt: "Continue" });
    expect(resumed.config.taskGraphExperiments).toBeUndefined();
    expect(compatibleResumeId(legacy, resumed.config)).toBe("legacy-thread");

    const started = resolveNewPrimaryRunConfig(legacyJson, { harness: "codex" });
    expect(started.config.taskGraphExperiments).toEqual({
      decisionContinuations: true, semanticPartitioning: false, questionGraph: false,
    });
    expect(compatibleResumeId(legacy, started.config)).toBeUndefined();
    expect(resolvePrimaryRunConfig(started.json, { prompt: "Continue" }).config.taskGraphExperiments)
      .toEqual(started.config.taskGraphExperiments);
  });

  it("respects saved opt-outs and defaults omitted project flags only for a new iteration", () => {
    const settings = vi.spyOn(projectStore, "readSettings").mockReturnValue({ taskGraphExperiments: { decisionContinuations: false } });
    try {
      const control = resolveNewPrimaryRunConfig(null, { harness: "codex" }, "/project");
      expect(control.config.taskGraphExperiments).toEqual({
        decisionContinuations: false, semanticPartitioning: false, questionGraph: false,
      });
      settings.mockReturnValue({ taskGraphExperiments: { questionGraph: true } });
      expect(resolvePrimaryRunConfig(control.json, { prompt: "Continue" }).config.taskGraphExperiments)
        .toEqual(control.config.taskGraphExperiments);
      expect(resolveNewPrimaryRunConfig(control.json, {}, "/project").config.taskGraphExperiments).toEqual({
        decisionContinuations: true, semanticPartitioning: false, questionGraph: true,
      });
      settings.mockReturnValue({});
      expect(resolveNewPrimaryRunConfig(control.json, {}, "/project").config.taskGraphExperiments).toEqual({
        decisionContinuations: true, semanticPartitioning: false, questionGraph: false,
      });
    } finally { settings.mockRestore(); }
  });

  it("does not reuse a defaulted provider thread when switching harnesses", () => {
    const previous = { session_id: "claude-thread", harness_name: "claude",
      run_config_json: JSON.stringify({ orchestrationMode: "auto" }) };
    expect(compatibleResumeId(previous, { harness: "codex" })).toBeUndefined();
    expect(compatibleResumeId(previous, { harness: "claude" })).toBe("claude-thread");
  });
  it("persists Task Graph auto mode when a canonical launch omits the planning mode", () => {
    const { config, json } = resolvePrimaryRunConfig(null, { prompt: "Build it" });

    expect(config.orchestrationMode).toBe("auto");
    expect(JSON.parse(json)).toMatchObject({ orchestrationMode: "auto" });
  });

  it("migrates an existing legacy debug mode when updating run config", () => {
    const { config } = resolvePrimaryRunConfig(
      JSON.stringify({ orchestrationMode: "direct", harness: "codex" }),
      { prompt: "Continue" },
    );

    expect(config.orchestrationMode).toBe("auto");
  });

  it("ignores a direct-mode override from an older client", () => {
    const { config } = resolvePrimaryRunConfig(null, { orchestrationMode: "direct" });
    expect(config.orchestrationMode).toBe("auto");
  });

  it("stages bounded connected context and orchestration mode before launch", () => {
    const context = "<connected-context>Design</connected-context>";
    const { config } = resolvePrimaryRunConfig(null, {
      prompt: `Build it\n${context}`,
      orchestrationMode: "plan",
    });

    expect(config).toMatchObject({ orchestrationMode: "plan", planningContext: context });
  });

  it("rejects an oversized pre-launch connected-context block", () => {
    const prompt = `<connected-context>${"x".repeat(2 * 1024 * 1024)}</connected-context>`;
    expect(() => resolvePrimaryRunConfig(null, { prompt, orchestrationMode: "auto" }))
      .toThrow("2 MiB");
  });
});

it("does not let source additions overwrite the complete snapshot or pollute user directives", () => {
  const full = "<connected-context>Existing A and new B</connected-context>";
  const prior = resolvePrimaryRunConfig(null, { prompt: full + "\nInitial request" });
  const delta = '<connected-context-update><context-group source-id="b" update="add">B</context-group></connected-context-update>';
  const next = resolvePrimaryRunConfig(prior.json, { prompt: delta + "\nNext request" });
  expect(next.config.planningContext).toBe(full);
  expect(next.config.userDirectives).toEqual(["Initial request", "Next request"]);
});

it("retains MCP selections through continuation and preserves an explicit clear", () => {
  const initial = resolvePrimaryRunConfig(null, { connectionIds: ["docs"] });
  expect(resolvePrimaryRunConfig(initial.json, {}).config.connectionIds).toEqual(["docs"]);
  const cleared = resolvePrimaryRunConfig(initial.json, { connectionIds: [] });
  expect(resolvePrimaryRunConfig(cleared.json, {}).config.connectionIds).toEqual([]);
});
