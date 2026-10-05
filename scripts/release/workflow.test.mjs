import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { TARGETS, NODE_VERSION } from "./config.mjs";

test("publication is tag-only and depends on all native verification jobs", () => {
  const workflow = parse(readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.jobs.publish.needs, ["verify", "native"]);
  assert.match(workflow.jobs.publish.if, /event_name == 'push'.*ref_type == 'tag'/);
  assert.deepEqual(workflow.jobs.native.strategy.matrix.include.map(row => row.target).sort(), Object.keys(TARGETS).sort());
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (step.uses?.startsWith("actions/setup-node@")) assert.equal(step.with["node-version"], NODE_VERSION);
    }
  }
  const nativeCommands = workflow.jobs.native.steps.filter(step => step.run).map(step => step.run).join("\n");
  assert.match(nativeCommands, /test:release/); assert.match(nativeCommands, /release\/smoke.mjs/);
  const publish = workflow.jobs.publish.steps.filter(step => step.run).map(step => step.run).join("\n");
  assert.match(publish, /gates.mjs publish/); assert.match(publish, /gates.mjs assets/);
  assert.match(publish, /attestation verify/); assert.match(publish, /--prerelease/); assert.match(publish, /--verify-tag/);
  assert.doesNotMatch(publish, /--clobber/);
});
