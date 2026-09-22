import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { observeStartup, releaseStartupObserver } from "./startup-observer.mjs";

function fixture(code) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "pipe", "ipc"], env });
}

test("startup observation reports spawn errors", async () => {
  const child = spawn(join(tmpdir(), "swarmcrews-nonexistent-executable"), [], { stdio: "ignore" });
  try { await assert.rejects(observeStartup(child), /ENOENT/); }
  finally { releaseStartupObserver(child); }
});

test("startup observation treats even a clean early exit as failure", async () => {
  const child = fixture('console.error("early diagnostic"); process.exit(0);');
  try { await assert.rejects(observeStartup(child), /Runner exited \(0\).*\nearly diagnostic/); }
  finally { releaseStartupObserver(child); }
});

test("bootstrap diagnostics retain a bounded recent tail", async () => {
  const child = fixture('process.stderr.write("old-output" + "x".repeat(100000) + "final-error", () => process.exit(1));');
  try {
    await assert.rejects(observeStartup(child), error => {
      assert.ok(error.message.endsWith("final-error"));
      assert.ok(!error.message.includes("old-output"));
      assert.ok(error.message.length < 66_000);
      return true;
    });
  } finally { releaseStartupObserver(child); }
});

test("a known startup failure waits for cleanup past the observation window", async () => {
  const child = fixture(`
    process.on("message", () => {
      process.send({ type: "startup-failure", message: "service failed", output: "service diagnostic" });
      // Simulate slow service cleanup, not a test wait for state.
      setTimeout(() => process.exit(1), 300);
    });
    process.send("ready");
  `);
  try {
    await once(child, "message");
    const observed = observeStartup(child, 100);
    child.send("start");
    await assert.rejects(observed, /service failed\nservice diagnostic/);
    assert.equal(child.exitCode, 1);
  } finally { child.kill(); releaseStartupObserver(child); }
});
