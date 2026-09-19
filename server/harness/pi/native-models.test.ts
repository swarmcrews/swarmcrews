import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverPiNativeMetadata } from "./native-models.ts";
import { getPiModels, setPiModels } from "./models.ts";
import { checkPiReadiness } from "./runtime.ts";

const directories: string[] = [];
function fixture(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-native-models-"));
  directories.push(dir);
  const script = path.join(dir, "fixture.mjs");
  const executable = path.join(dir, "pi");
  fs.writeFileSync(script, body);
  fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script}' "$@"\n`, { mode: 0o755 });
  return executable;
}
afterEach(() => {
  setPiModels([]);
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const onRequest = (body: string) => `
import { readSync, writeSync } from "node:fs";
import assert from "node:assert/strict";
assert.deepEqual(process.argv.slice(2), ["--mode", "rpc", "--no-session", "--no-extensions", "--no-skills", "--no-tools"]);
assert.equal(process.env.PI_OFFLINE, "1");
// Block on the request rather than relying on readline to keep a short-lived
// fixture alive. This also makes early EOF an explicit fixture failure.
const input = Buffer.alloc(1024);
let line = "";
while (!line.includes("\\n")) {
  const count = readSync(0, input, 0, input.length, null);
  assert.notEqual(count, 0, "probe must send a request before closing stdin");
  line += input.toString("utf8", 0, count);
}
const request = JSON.parse(line);
assert.deepEqual(request, { id: "swarmcrews-models", type: "get_available_models" });
${body}
`;

describe("native Pi catalog probe", () => {
  it("discovers Astra's full reasoning range without expanding other models' capabilities", async () => {
    // Capability-only fixture from Pi's Astra catalog; no account data or live requests.
    const nativeModels = [
      { provider: "openai-codex", id: "gpt-6-astra", reasoning: true,
        thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium",
          high: "high", xhigh: "xhigh", max: "max" } },
      { provider: "custom", id: "standard", reasoning: true },
      { provider: "custom", id: "text", reasoning: false },
    ];
    const executable = fixture(`
      if (process.argv.includes("--list-models")) {
        console.log("provider  model  context  max-out  thinking  images\\n" +
          "openai-codex  gpt-6-astra  200K  64K  yes  yes\\n" +
          "custom  standard  128K  8K  yes  no\\n" +
          "custom  text  128K  8K  no  no");
        process.exit(0);
      }
      ${onRequest(`writeSync(1, JSON.stringify({ type: "response", id: request.id,
        success: true, data: { models: ${JSON.stringify(nativeModels)} } }) + "\\n");`)}
    `);
    expect(await checkPiReadiness({ signal: new AbortController().signal }, {
      resolve: () => ({ executable, source: "env_override" }),
    })).toMatchObject({ state: "ready" });
    expect(getPiModels()).toMatchObject([
      { id: "openai-codex/gpt-6-astra", source: "dynamic", supportsReasoning: true,
        supportedEffortLevels: ["minimal", "low", "medium", "high", "xhigh", "max"] },
      { id: "custom/standard", supportedEffortLevels: ["minimal", "low", "medium", "high"] },
      { id: "custom/text", supportsReasoning: false, supportedEffortLevels: [] },
    ]);
  });

  it("queries the configured executable without a prompt and only returns capability metadata", async () => {
    const executable = fixture(onRequest(`
      writeSync(1, "startup notice\\n");
      writeSync(1, JSON.stringify({ type: "response", id: "other", success: true }) + "\\n");
      const response = JSON.stringify({ type: "response", id: request.id, success: true, data: { models: [
        { provider: "custom", id: "reasoner", reasoning: true, thinkingLevelMap: { low: null, xhigh: "high", max: "max" }, headers: { authorization: "must-not-return" } },
        { provider: "custom", id: "text", reasoning: false },
        { provider: "invalid", id: "missing-reasoning" }, null
      ] } });
      writeSync(1, response.slice(0, 20));
      writeSync(1, response.slice(20) + "\\n");
    `));
    expect(await discoverPiNativeMetadata(executable, new AbortController().signal)).toEqual([
      { provider: "custom", id: "reasoner", reasoning: true, thinkingLevelMap: { low: null, xhigh: "high", max: "max" } },
      { provider: "custom", id: "text", reasoning: false, thinkingLevelMap: {} },
    ]);
  });

  it("degrades safely when RPC is unsupported", async () => {
    expect(await discoverPiNativeMetadata(fixture("process.exit(2)"), new AbortController().signal)).toEqual([]);
  });

  it("does not fall back to another installed package when the configured executable is missing", async () => {
    expect(await discoverPiNativeMetadata("/nonexistent/pi-fixture", new AbortController().signal)).toEqual([]);
  });

  it("rejects an unsuccessful response", async () => {
    const executable = fixture(onRequest('writeSync(1, JSON.stringify({ type: "response", id: request.id, success: false }) + "\\n");'));
    expect(await discoverPiNativeMetadata(executable, new AbortController().signal)).toEqual([]);
  });

  it("bounds output and terminates a noisy process", async () => {
    const executable = fixture(onRequest('writeSync(1, "x".repeat(1_048_577));'));
    expect(await discoverPiNativeMetadata(executable, new AbortController().signal)).toEqual([]);
  });

  it("terminates a probe on abort", async () => {
    const executable = fixture(onRequest("readSync(0, input, 0, input.length, null); // Wait for input that never arrives."));
    expect(await discoverPiNativeMetadata(executable, AbortSignal.timeout(100))).toEqual([]);
    expect(await discoverPiNativeMetadata(executable, AbortSignal.abort())).toEqual([]);
  });
});
