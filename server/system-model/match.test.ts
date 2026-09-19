import { globMatches } from "./match.ts";
import { describe, expect, it } from "vitest";
import { matchSystemModel } from "./match.ts";
import { loadSystemModel } from "./load.ts";
import { copyValidFixtureWithSurfaces } from "../../tests/support/system-model-fixture.ts";

describe("matchSystemModel", () => {
  it("scores deterministic top-K candidates with reason strings", () => {
    const model = loadSystemModel("tests/fixtures/system-model/valid").model!;
    const result = matchSystemModel({
      model,
      request: "worktree approve session",
      files: ["server/commands/approve-changes.ts"],
      topK: 2,
    });

    expect(result.matchConfidence).toBe("medium");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      "flow.approve_changes",
      "capability.workspace_management",
    ]);
    expect(result.candidates[0]?.reasons.join(" ")).toContain("file evidence matched");
    expect(result.candidates[1]?.reasons.join(" ")).toContain("primary-capability support");
  });

  it("scores every object type from its contract fields", () => {
    const model = loadSystemModel("tests/fixtures/system-model/valid").model!;

    expect(matchSystemModel({ model, request: "workspace", objectTypes: ["capability"] }).candidates[0]).toMatchObject({
      id: "capability.workspace_management",
      type: "capability",
      score: expect.any(Number),
      reasons: ["text matched 1 query term"],
    });
    expect(matchSystemModel({ model, request: "approve inspect" }).candidates[0]).toMatchObject({
      id: "flow.approve_changes",
      score: expect.any(Number),
      reasons: ["text matched 2 query terms"],
    });
    expect(matchSystemModel({ model, request: "outbound direct", files: ["server/commands/index.ts"] }).candidates[0]).toMatchObject({
      id: "constraint.bus_only",
      score: expect.any(Number),
      reasons: expect.arrayContaining(["text matched 2 query terms", expect.stringContaining("file evidence")]),
    });
    expect(matchSystemModel({ model, request: "typed payloads" }).candidates[0]).toMatchObject({
      id: "decision.bus_architecture",
      score: expect.any(Number),
      reasons: ["text matched 2 query terms"],
    });
    expect(matchSystemModel({ model, request: "centrally" }).candidates[0]).toMatchObject({
      id: "risk.merge_bypass",
      score: expect.any(Number),
      reasons: ["text matched 1 query term"],
    });
  });

  it("applies topK after deterministic score and id ordering", () => {
    const model = loadSystemModel("tests/fixtures/system-model/valid").model!;
    const result = matchSystemModel({ model, request: "merge", topK: 1 });

    const all = matchSystemModel({ model, request: "merge", topK: 100 }).candidates;
    expect(result.candidates).toEqual(all.slice(0, 1));
    expect(all).toEqual([...all].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)));
    model.objectsById = new Map([...model.objectsById].reverse());
    expect(matchSystemModel({ model, request: "merge", topK: 100 }).candidates).toEqual(all);
  });

  it("returns low confidence with fallback instruction when no candidate scores", () => {
    const model = loadSystemModel("tests/fixtures/system-model/valid").model!;
    const result = matchSystemModel({ model, request: "paint a canvas", files: ["src/App.tsx"] });

    expect(result.candidates).toEqual([]);
    expect(result.matchConfidence).toBe("low");
    expect(result.fallbackInstruction).toBe("inspect repo; ask only if required");
  });

  it("ranks surfaces and attributes capability entry-point file matches", () => {
    const model = loadSystemModel(copyValidFixtureWithSurfaces()).model!;
    expect(matchSystemModel({ model, request: "mobile" }).candidates[0]).toMatchObject({
      id: "surface.mobile",
      type: "surface",
      score: expect.any(Number),
    });
    const capability = matchSystemModel({
      model,
      request: "unrelated",
      files: ["src/mobile/App.tsx"],
    }).candidates.find((candidate) => candidate.id === "capability.workspace_management");
    expect(capability).toMatchObject({
      score: expect.any(Number),
      reasons: expect.arrayContaining(["file matches entry point surface.mobile"]),
    });
  });
});


describe("policy glob semantics", () => {
  it.each(["server/a.ts", "server/commands/remove.ts"])("matches %s under server/**/*.ts", file => {
    expect(globMatches("server/**/*.ts", file)).toBe(true);
  });
  it("keeps single-star matches within one directory", () => {
    expect(globMatches("server/*.ts", "server/bus.ts")).toBe(true);
    expect(globMatches("server/*.ts", "server/commands/remove.ts")).toBe(false);
    expect(globMatches("server/*.ts", "src/bus.ts")).toBe(false);
  });
});
