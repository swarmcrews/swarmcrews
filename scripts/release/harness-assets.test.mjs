import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyHarnessAssets } from "./harness-assets.mjs";

test("portable Pi extension imports without a TypeScript loader or repository dependencies", async () => {
  const app = mkdtempSync(join(tmpdir(), "harness-assets-"));
  try {
    copyHarnessAssets(fileURLToPath(new URL("../../", import.meta.url)), app);
    const extension = await import(pathToFileURL(join(app, "server/harness/pi/swarm-tools-extension.mjs")).href);
    assert.equal(typeof extension.default, "function");
    const { toolResultText } = await import(pathToFileURL(join(app, "server/harness/tool-result-text.mjs")).href);
    assert.deepEqual(JSON.parse(toolResultText({ content: [{ type: "text", text: "Summary" }], structuredContent: { cursor: null } })),
      { content: [{ type: "text", text: "Summary" }], structuredContent: { cursor: null } });
  } finally { rmSync(app, { recursive: true, force: true }); }
});
