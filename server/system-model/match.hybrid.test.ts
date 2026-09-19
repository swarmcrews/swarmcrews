import { describe, expect, it } from "vitest";
import { copyValidFixtureWithSurfaces } from "../../tests/support/system-model-fixture.ts";
import { loadSystemModel } from "./load.ts";
import { matchSystemModel } from "./match.ts";

const fixture = () => loadSystemModel(copyValidFixtureWithSurfaces()).model!;

describe("hybrid system-model retrieval", () => {
  it("finds decision documents by normalized exact file evidence", () => {
    const model = fixture();
    const decision = { ...model.decisions[0]!, file: "decisions/ADR-007-workspace.md" };
    model.objectsById.set(decision.id, decision);
    const result = matchSystemModel({ model, request: "", files: ["./decisions\\ADR-007-workspace.md"] });
    expect(result.candidates[0]).toMatchObject({ id: decision.id, type: "decision" });
    expect(result.candidates[0]!.reasons.join(" ")).toContain("file");
    expect(result.matchConfidence).toBe("low");
  });

  it("indexes tests, entry-point tests and path-valued evidence", () => {
    const model = fixture();
    const capability = { ...model.capabilities[0]!, suggestedTests: ["tests/workspace.test.ts"],
      entryPoints: [{ surface: "surface.canvas", files: [], tests: ["tests/canvas-entry.test.tsx"], flows: [] }] };
    const decision = { ...model.decisions[0]!, evidence: ["evidence/workspace-review.md"] };
    model.objectsById.set(capability.id, capability);
    model.objectsById.set(decision.id, decision);
    for (const file of ["tests/workspace.test.ts", "tests/canvas-entry.test.tsx"]) {
      expect(matchSystemModel({ model, request: "", files: [file] }).candidates[0]?.id).toBe(capability.id);
    }
    expect(matchSystemModel({ model, request: "", files: [decision.evidence[0]!] }).candidates[0]?.id).toBe(decision.id);
  });

  it("does not score stopwords as architecture evidence", () => {
    const result = matchSystemModel({ model: fixture(), request: "the a in to and" });
    expect(result).toEqual({ candidates: [], matchConfidence: "low", fallbackInstruction: "inspect repo; ask only if required" });
  });

  it("keeps expansion-only evidence low confidence and explains it", () => {
    const model = fixture();
    const capability = { ...model.capabilities[0]!, name: "Usage cost", summary: "Track usage cost", keywords: ["usage", "cost"] };
    model.objectsById.set(capability.id, capability);
    const result = matchSystemModel({ model, request: "spending expense" });
    expect(result.candidates[0]?.id).toBe(capability.id);
    expect(result.matchConfidence).toBe("low");
    expect(result.candidates[0]!.reasons.join(" ")).toContain("related");
  });

  it("filters types after corpus scoring without changing eligible scores", () => {
    const model = fixture();
    const input = { model, request: "workspace approve session", topK: 100 };
    const all = matchSystemModel(input).candidates;
    const filtered = matchSystemModel({ ...input, objectTypes: ["flow", "decision"] }).candidates;
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered).toEqual(all.filter(c => c.type === "flow" || c.type === "decision"));
  });

  it("observes changed model content without stale index entries", () => {
    const model = fixture();
    const decision = { ...model.decisions[0]!, file: "decisions/old.md" };
    model.objectsById.set(decision.id, decision);
    expect(matchSystemModel({ model, request: "", files: ["decisions/old.md"] }).candidates[0]?.id).toBe(decision.id);
    decision.file = "decisions/new.md";
    expect(matchSystemModel({ model, request: "", files: ["decisions/old.md"] }).candidates).toEqual([]);
    expect(matchSystemModel({ model, request: "", files: ["decisions/new.md"] }).candidates[0]?.id).toBe(decision.id);
    model.objectsById.delete(decision.id);
    expect(matchSystemModel({ model, request: "", files: ["decisions/new.md"] }).candidates).toEqual([]);
  });

  it("supports keyword hints and applies result limits after ranking", () => {
    const model = fixture();
    const result = matchSystemModel({ model, request: "", keywords: ["workspace", "approve"], topK: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates).toEqual(matchSystemModel({ model, request: "workspace approve", topK: 100 }).candidates.slice(0, 1));
    expect(matchSystemModel({ model, request: "workspace", topK: 0 }).candidates).toEqual([]);
  });
});
