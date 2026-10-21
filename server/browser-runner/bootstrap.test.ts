import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { containerArguments } from "./backend.ts";
import { runnerSchema } from "./policy.ts";

// No container, browser, webserver or host dependency writes. Exercise the generated
// shell bootstrap with container paths mapped to a temporary filesystem fixture.
it.skipIf(process.platform !== "linux" || process.getuid?.() === 0)("boots the real Vite config and optimizer without writing image dependencies", async () => {
  const base = await mkdtemp(join(tmpdir(), "browser-vite-bootstrap-"));
  const source = join(base, "input"); const work = join(base, "work"); const dependencies = join(base, "image-dependencies");
  await Promise.all([mkdir(source), mkdir(work), mkdir(dependencies)]);
  try {
    for (const entry of await readdir(resolve("node_modules"))) {
      if ([".vite", ".vite-temp"].includes(entry)) continue;
      await symlink(resolve("node_modules", entry), join(dependencies, entry));
    }
    // Even an image containing prior Vite caches must not share them with a run.
    for (const cache of [".vite", ".vite-temp"]) {
      await mkdir(join(dependencies, cache), { mode: 0o555 });
    }
    // Read-only stand-in for the image's immutable dependency root. Never chmod
    // the real dependencies. The opt-in live test covers EROFS/kernel isolation.
    await chmod(dependencies, 0o555);
    const imageEntries = await readdir(dependencies);
    for (const file of ["vite.config.ts", "build/theme-bootstrap.ts", "shared/browser-security-headers.ts", "src/themes.ts"]) {
      const target = join(source, file);
      await mkdir(dirname(target), { recursive: true }); await copyFile(resolve(file), target);
    }
    await writeFile(join(source, "package.json"), JSON.stringify({ type: "module", scripts: { "test:smoke": "node fixture.mjs" } }));
    await writeFile(join(source, "fixture.mjs"), `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolveConfig, optimizeDeps } from 'vite';
const config = await resolveConfig({ root: process.cwd(), logLevel: 'silent', optimizeDeps: { include: ['react'], noDiscovery: true } }, 'serve');
assert.ok(config.plugins.some(plugin => plugin.name === 'theme-bootstrap'));
assert.equal(config.server.headers['X-Frame-Options'], 'DENY');
const metadata = await optimizeDeps(config, true, true);
assert.ok(metadata.optimized.react);
await writeFile('result.json', JSON.stringify({ cacheDir: config.cacheDir, optimized: metadata.optimized.react.file }));
`);
    const runner = runnerSchema.parse({ id: "local", image: `sha256:${"a".repeat(64)}`, grants: [] });
    const args = containerArguments({ id: "bootstrap", runner, suite: "smoke" }, "/unused-snapshot");
    const command = args.at(-1)!.replaceAll("/opt/browser-runner/node_modules", dependencies).replaceAll("/input", source).replaceAll("/work", work);
    await promisify(execFile)("/bin/sh", ["-c", command], { cwd: work, timeout: 30000, maxBuffer: 65536 });
    expect((await stat(join(work, "node_modules", ".vite-temp"))).isDirectory()).toBe(true);
    expect(await realpath(join(work, "node_modules"))).toBe(join(work, "node_modules"));
    const result = JSON.parse(await readFile(join(work, "result.json"), "utf8"));
    expect(result.cacheDir).toBe(join(work, "node_modules", ".vite"));
    expect(result.optimized).toBe(join(work, "node_modules", ".vite", "deps", "react.js"));
    expect(await readFile(result.optimized, "utf8")).toContain("react");
    expect(await readdir(dependencies)).toEqual(imageEntries);
    for (const cache of [".vite", ".vite-temp"]) {
      expect(await readdir(join(dependencies, cache))).toEqual([]);
    }
    expect(await realpath(join(work, "node_modules", "react"))).toBe(await realpath(resolve("node_modules/react")));
  } finally {
    await chmod(dependencies, 0o755); await rm(base, { recursive: true, force: true });
  }
}, 40000);
