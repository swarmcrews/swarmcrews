import { describe, expect, it } from "vitest";
import { isProjectContextEmpty } from "./project-context.ts";

describe("repository project context", () => {
  it.each([undefined, null, { exists: false, content: "" }, { exists: true, content: " \n\t" }])(
    "treats missing or whitespace-only AGENTS.md as empty: %j", (context) => {
      expect(isProjectContextEmpty(context)).toBe(true);
    },
  );

  it("does not discard repository instructions containing the former placeholder text", () => {
    expect(isProjectContextEmpty({ exists: true,
      content: "# Instructions\n\nProject context has not been configured yet.\nUse pnpm to run tests.",
    })).toBe(false);
  });
});
