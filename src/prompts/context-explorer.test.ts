import { describe, expect, it } from "vitest";
import { CONTEXT_EXPLORER_PROMPT } from "./context-explorer.ts";

describe("CONTEXT_EXPLORER_PROMPT", () => {
  it("saves AGENTS.md through the context tool and preserves existing instructions", () => {
    const prompt = CONTEXT_EXPLORER_PROMPT("/project");

    expect(prompt).toContain("call `update_project_context` exactly once");
    expect(prompt).toContain("subsequently delegated Minion agents");
    expect(prompt).toContain("creating `AGENTS.md` when missing");
    expect(prompt).toContain("preserve its instructions and user-authored guidance");
    expect(prompt).toContain("Do not save a separate `context.md` or `CLAUDE.md`");
    expect(prompt).not.toMatch(/produce a context\.md/i);
  });
});
