import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExternalSdk } from "./external-sdk.ts";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "external-sdk-"));
  roots.push(root);
  const pkg = join(root, "node_modules", "example-sdk");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "example-sdk", type: "module", exports: "./index.js" }));
  writeFileSync(join(pkg, "index.js"), "export const loaded = true;");
  return root;
}
describe("external provider SDK resolution", () => {
  it("leaves source checkout dependency loading unchanged", () => {
    expect(resolveExternalSdk("example-sdk", "EXAMPLE_SDK_ROOT", {})).toBeNull();
  });
  it("requires an explicit SDK installation for portable packages", () => {
    expect(() => resolveExternalSdk("example-sdk", "EXAMPLE_SDK_ROOT", { SWARMCREWS_PACKAGED: "1" })).toThrow(/EXAMPLE_SDK_ROOT/);
  });
  it("resolves and loads a separate installation using a file URL", async () => {
    const root = fixture();
    const url = resolveExternalSdk("example-sdk", "EXAMPLE_SDK_ROOT", { EXAMPLE_SDK_ROOT: root });
    expect(fileURLToPath(url!)).toBe(join(root, "node_modules", "example-sdk", "index.js"));
    expect(await import(url!)).toMatchObject({ loaded: true });
  });
  it("resolves import-only conditional exports used by the Codex SDK", async () => {
    const root = fixture();
    const pkg = join(root, "node_modules", "example-sdk");
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "example-sdk", type: "module", exports: { import: "./index.js", types: "./index.d.ts" } }));
    const url = resolveExternalSdk("example-sdk", "EXAMPLE_SDK_ROOT", { EXAMPLE_SDK_ROOT: root });
    expect(await import(url!)).toMatchObject({ loaded: true });
  });
  it("resolves each supported real provider SDK from an explicit source prefix", async () => {
    for (const name of ["@anthropic-ai/claude-agent-sdk", "@openai/codex-sdk", "@github/copilot-sdk"]) {
      const url = resolveExternalSdk(name, "SDK_ROOT", { SDK_ROOT: process.cwd(), SWARMCREWS_PACKAGED: "1" });
      expect(url).toMatch(/^file:/);
      expect(await import(url!)).toBeTruthy();
    }
  });
  it("rejects relative roots and missing installations instead of falling back", () => {
    expect(() => resolveExternalSdk("example-sdk", "EXAMPLE_SDK_ROOT", { EXAMPLE_SDK_ROOT: "relative" })).toThrow(/absolute/);
    expect(() => resolveExternalSdk("absent-sdk", "EXAMPLE_SDK_ROOT", { EXAMPLE_SDK_ROOT: fixture() })).toThrow(/Install absent-sdk separately/);
  });
});
