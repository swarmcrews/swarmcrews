import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { releaseTarget } from "./config.mjs";
import { nativeTar } from "./command.mjs";

for (const scenario of ["verified", "corrupt", "existing"]) {
  test(`native download-only installer: ${scenario}`, () => {
    const root = mkdtempSync(join(tmpdir(), "portable-installer-"));
    try {
      const target = releaseTarget();
      const name = `swarmcrews-0.1.0-alpha.1-${target}`;
      const win = process.platform === "win32";
      const tree = join(root, name); mkdirSync(join(tree, "runtime"), { recursive: true });
      writeFileSync(join(tree, win ? "swarmcrews.cmd" : "swarmcrews"), "must not execute");
      const node = join(tree, "runtime", win ? "node.exe" : "node"); writeFileSync(node, "fixture runtime"); chmodSync(node, 0o755);
      const archive = join(root, `${name}.${win ? "zip" : "tar.gz"}`);
      execFileSync(nativeTar(), win ? ["-a", "-cf", archive, "-C", root, name] : ["-czf", archive, "-C", root, name]);
      const checksum = join(root, "checksum");
      const digest = scenario === "corrupt" ? "0".repeat(64) : createHash("sha256").update(readFileSync(archive)).digest("hex");
      writeFileSync(checksum, `${digest}  ${name}.${win ? "zip" : "tar.gz"}\n`);
      const destination = join(root, "new install");
      if (scenario === "existing") { mkdirSync(destination); writeFileSync(join(destination, "keep"), "untouched"); }
      const env = { ...process.env, FIXTURE_ARCHIVE: archive, FIXTURE_CHECKSUM: checksum, FIXTURE_DESTINATION: destination };
      let result;
      if (win) {
        env.FIXTURE_INSTALLER = resolve("install/portable.ps1");
        const wrapper = join(root, "download-boundary.ps1");
        writeFileSync(wrapper, `function Invoke-WebRequest { param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile, [int]$TimeoutSec)\nif ($Uri.EndsWith('.sha256')) { Copy-Item -LiteralPath $env:FIXTURE_CHECKSUM -Destination $OutFile } else { Copy-Item -LiteralPath $env:FIXTURE_ARCHIVE -Destination $OutFile }\n}\n& $env:FIXTURE_INSTALLER -Destination $env:FIXTURE_DESTINATION\n`);
        result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper], { env, encoding: "utf8", timeout: 30_000 });
      } else {
        const bin = join(root, "bin"); mkdirSync(bin);
        const curl = join(bin, "curl");
        writeFileSync(curl, '#!/bin/sh\nset -eu\nsource=$FIXTURE_ARCHIVE\nwhile [ "$#" -gt 0 ]; do\n case "$1" in *.sha256) source=$FIXTURE_CHECKSUM ;; -o) shift; output=$1 ;; esac\n shift\ndone\ncp "$source" "$output"\n', { mode: 0o755 });
        env.PATH = `${bin}:${process.env.PATH}`;
        result = spawnSync("sh", [resolve("install/portable.sh"), destination], { env, encoding: "utf8", timeout: 30_000 });
      }
      assert.equal(result.error, undefined);
      if (scenario === "verified") {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(readFileSync(join(destination, "runtime", win ? "node.exe" : "node"), "utf8"), "fixture runtime");
      } else {
        assert.notEqual(result.status, 0);
        if (scenario === "existing") assert.equal(readFileSync(join(destination, "keep"), "utf8"), "untouched");
        else assert.equal(existsSync(destination), false);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
