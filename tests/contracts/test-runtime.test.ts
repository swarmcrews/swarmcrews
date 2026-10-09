// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "os";
import { join } from "node:path";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react/pure";

// jsdom tests still execute in Node. Both bare and node:-prefixed builtins
// must reach the real runtime, not Vite's browser-external placeholder.
describe("test runtime isolation from the launch environment", () => {
  it("uses the test environment and a React build with act support", () => {
    expect(process.env["NODE_ENV"]).toBe("test");
    try {
      render(createElement("button", null, "Test action"));
      expect(screen.getByRole("button", { name: "Test action" }).textContent).toBe("Test action");
    } finally {
      cleanup();
    }
  });
  it("keeps DOM APIs and real temporary-file IO available together", async () => {
    expect(document.createElement("div").tagName).toBe("DIV");
    const directory = await mkdtemp(join(tmpdir(), "vitest-builtins-"));
    try {
      const file = join(directory, "fixture.txt");
      await writeFile(file, "portable fixture");
      expect(await readFile(file, "utf8")).toBe("portable fixture");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
