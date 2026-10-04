import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverCodexModels } from "./native-models.ts";
import { getCodexModels, setCodexModels, resolveCodexModel } from "./models.ts";
import { checkCodexReadiness } from "./runtime.ts";

const directories: string[] = [];
function fixture(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-models-"));
  directories.push(dir);
  const script = path.join(dir, "fixture.mjs");
  const executable = path.join(dir, "codex");
  fs.writeFileSync(script, `import readline from "node:readline";
import assert from "node:assert/strict";
import os from "node:os";
if (process.argv[2] === "login") process.exit(0);
assert.equal(process.cwd(), os.homedir());
assert.deepEqual(process.argv.slice(2), ["app-server", "--listen", "stdio://"]);
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let initialized = false;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
 const request = JSON.parse(line);
 if (request.method === "initialize") { send({ id: request.id, result: {} }); return; }
 if (request.method === "initialized") { initialized = true; return; }
 assert.equal(initialized, true);
 assert.equal(request.method, "model/list");
 assert.equal(request.params.includeHidden, false);
 ${body}
});`);
  fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script}' "$@"\n`, { mode: 0o755 });
  return { executable, source: "env_override" as const, env: { ...process.env, OPENAI_PROJECT_ID: "configured-project", GITHUB_TOKEN: "must-not-forward", AWS_SECRET_ACCESS_KEY: "must-not-forward" } };
}
const model = { id: "picker-id", model: "gpt-5.4", displayName: "Native GPT", hidden: false, isDefault: true,
  supportedReasoningEfforts: [
    { reasoningEffort: "low", description: "Fast" },
    { reasoningEffort: "high", description: "Thorough" },
    { reasoningEffort: "xhigh", description: "Extra thorough" },
  ], defaultReasoningEffort: "high" };
afterEach(() => {
  setCodexModels([]);
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Codex native model discovery", () => {
  it("initializes the configured app-server, follows pagination, and uses launch model IDs", async () => {
    const runtime = fixture(`
      assert.equal(process.env.OPENAI_PROJECT_ID, "configured-project");
      assert.equal(process.env.GITHUB_TOKEN, undefined);
      assert.equal(process.env.AWS_SECRET_ACCESS_KEY, undefined);
      if (!request.params.cursor) {
        process.stdout.write("startup notice\\n");
        send({ method: "notification", params: {} });
        send({ id: request.id, result: { data: [${JSON.stringify(model)}], nextCursor: "page-2" } });
      } else {
        assert.equal(request.params.cursor, "page-2");
        send({ id: request.id, result: { data: [
          { model: "custom-new", displayName: "New model" },
          { model: "hidden", displayName: "Hidden", hidden: true },
          ${JSON.stringify(model)}, null
        ], nextCursor: null } });
      }
    `);
    expect(await checkCodexReadiness({ signal: new AbortController().signal }, { resolve: () => runtime })).toMatchObject({ state: "ready" });
    expect(getCodexModels()).toEqual([
      expect.objectContaining({ id: "gpt-5.4", label: "Native GPT (gpt-5.4)", source: "dynamic",
        supportsReasoning: true, supportedEffortLevels: ["low", "high", "xhigh"], defaultEffortLevel: "high" }),
      expect.objectContaining({ id: "custom-new", label: "New model (custom-new)", source: "dynamic" }),
    ]);
    expect(resolveCodexModel("gpt-5.4")).toBe("gpt-5.4");
    expect(resolveCodexModel("default")).toBe("gpt-5.4");
  });

  it.each([
    'send({ id: request.id, error: { message: "token-secret" } });',
    'send({ id: request.id, result: { data: "malformed" } });',
    'send({ id: request.id, result: { data: [], nextCursor: null } });',
    'process.exit(2);',
    'process.stdout.write("x".repeat(1_048_577));',
    'send({ id: request.id, result: { data: [], nextCursor: "repeated" } });',
  ])("fails safely and clears stale models: %s", async (body) => {
    setCodexModels([model]);
    const runtime = fixture(body);
    const result = await checkCodexReadiness({ signal: new AbortController().signal }, { resolve: () => runtime });
    expect(result).toMatchObject({ state: "probe_failed", auth: { authenticated: true } });
    expect(JSON.stringify(result)).not.toContain("token-secret");
    expect(getCodexModels()).toEqual([]);
  });

  it("terminates on abort, including before startup", async () => {
    const runtime = fixture("// never respond");
    await expect(discoverCodexModels(runtime, AbortSignal.timeout(100))).rejects.toThrow();
    await expect(discoverCodexModels(runtime, AbortSignal.abort())).rejects.toThrow();
  });

  it("fails without another runtime fallback when the executable is missing", async () => {
    await expect(discoverCodexModels({ executable: "/nonexistent/codex", env: {}, source: "env_override" }, new AbortController().signal)).rejects.toThrow();
  });

  it("clears stale models after authentication loss", async () => {
    setCodexModels([model]);
    const runtime = fixture("");
    await checkCodexReadiness({ signal: new AbortController().signal }, { resolve: () => runtime, run: async () => ({ code: 1, stdout: "" }) });
    expect(getCodexModels()).toEqual([]);
  });
});
