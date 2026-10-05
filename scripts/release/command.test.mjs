import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { commandSpec, nativeTar } from "./command.mjs";

test("Windows batch invocations use verbatim cmd quoting and reject shell expansion", () => {
  const spec = commandSpec("pnpm.cmd", ["exec", "tsc", "--outDir", "C:\\path with spaces\\output"], "win32");
  assert.equal(spec.options.windowsVerbatimArguments, true);
  assert.deepEqual(spec.args.slice(0, -1), ["/d", "/s", "/v:off", "/c"]);
  assert.equal(spec.args.at(-1), '""pnpm.cmd" "exec" "tsc" "--outDir" "C:\\path with spaces\\output""');
  for (const argument of ['%TEMP%', 'x&echo bad', 'x"y', 'x\ny']) assert.throws(() => commandSpec("npm.cmd", [argument], "win32"), /Unsafe/);
  assert.deepEqual(commandSpec("npm", ["ci"], "linux"), { command: "npm", args: ["ci"], options: {} });
});
test("native command execution preserves space-containing paths and arguments", () => {
  const root = mkdtempSync(join(tmpdir(), "release command "));
  try {
    const script = join(root, "arguments.mjs");
    writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)))");
    let spec;
    if (process.platform === "win32") {
      const wrapper = join(root, "launch fixture.cmd");
      writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
      spec = commandSpec(wrapper, ["argument with spaces"]);
    } else spec = commandSpec(process.execPath, [script, "argument with spaces"]);
    const output = execFileSync(spec.command, spec.args, { ...spec.options, encoding: "utf8", timeout: 10_000 });
    assert.deepEqual(JSON.parse(output), ["argument with spaces"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Windows ZIP extraction uses native tar even under Git Bash", () => {
  assert.equal(nativeTar("win32", "D:\\Windows"), "D:\\Windows\\System32\\tar.exe");
  assert.equal(nativeTar("linux"), "tar");
});
