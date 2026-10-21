import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PodmanBrowserBackend } from "./backend.ts";
import { runnerSchema } from "./policy.ts";

const image = process.env.SWARMCREWS_BROWSER_TEST_IMAGE;
// Explicit operator opt-in only. This verifies the real OS/container boundary, not mocks.
it.skipIf(!image)("launches Chromium and enforces live container restrictions", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "browser-live-fixture-")); const id = randomUUID();
  const script = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('playwright');
(async () => {
  assert.notEqual(process.getuid(), 0);
  assert.equal(process.env.SWARMCREWS_BROWSER_HOST_SECRET, undefined);
  assert.throws(() => fs.writeFileSync('/input/fixture.cjs', 'overwrite'));
  assert.throws(() => fs.writeFileSync('/etc/browser-runner-escape', 'overwrite'));
  assert.throws(() => fs.writeFileSync('/opt/browser-runner/node_modules/.write-probe', 'overwrite'));
  // Exercise Vite's ESM/TS config bundle and real optimizer against the actual
  // read-only image, not just Chromium talking to a hand-written HTTP server.
  const { resolveConfig, optimizeDeps } = await import('vite');
  const config = await resolveConfig({ root: '/work', logLevel: 'silent', optimizeDeps: { include: ['react'], noDiscovery: true } }, 'serve');
  assert.equal(config.cacheDir, '/work/node_modules/.vite');
  const metadata = await optimizeDeps(config, true, true);
  assert.ok(metadata.optimized.react);
  assert.ok(fs.statSync('/work/node_modules/.vite-temp').isDirectory());
  assert.ok(fs.statSync(metadata.optimized.react.file).isFile());
  assert.equal(fs.realpathSync('/work/node_modules'), '/work/node_modules');
  console.log('VITE_BOOTSTRAP_VERIFIED');
  const limit = path => Number(fs.readFileSync('/sys/fs/cgroup/' + path, 'utf8').trim());
  assert.ok(limit('memory.max') > 0 && limit('memory.max') <= 2048 * 1024 * 1024);
  assert.ok(limit('pids.max') > 0 && limit('pids.max') <= 256);
  const cpu = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(' ').map(Number);
  assert.ok(cpu[0] > 0 && cpu[0] / cpu[1] <= 2);
  assert.ok(Object.values(os.networkInterfaces()).flat().every(item => item.internal));
  const server = http.createServer((req, res) => res.end('<title>isolated browser</title>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    assert.equal(await page.title(), 'isolated browser');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log('BROWSER_BOUNDARY_VERIFIED');
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
  await writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module", scripts: { "test:smoke": "node fixture.cjs" } }));
  await writeFile(join(cwd, "vite.config.ts"), `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`);
  await writeFile(join(cwd, "fixture.cjs"), script);
  let log = ""; let digest = "";
  const previous = process.env.SWARMCREWS_BROWSER_HOST_SECRET;
  process.env.SWARMCREWS_BROWSER_HOST_SECRET = "must-not-enter-container";
  try {
    const result = await new PodmanBrowserBackend().execute({ id, cwd, suite: "smoke", runner: runnerSchema.parse({ id: "live", image, grants: [], timeoutSeconds: 60 }), signal: new AbortController().signal,
      output: text => { log = (log + text).slice(-65536); }, snapshot: value => { digest = value; } });
    expect(result, log).toEqual({ exitCode: 0 }); expect(log).toContain("BROWSER_BOUNDARY_VERIFIED"); expect(log).toContain("VITE_BOOTSTRAP_VERIFIED"); expect(digest).toHaveLength(64);
    expect(await readFile(join(cwd, "fixture.cjs"), "utf8")).toBe(script);
    const { stdout } = await promisify(execFile)("/usr/bin/podman", ["ps", "--all", `--filter=name=swarm-browser-${id}`, "--format={{.ID}}"]);
    expect(stdout.trim()).toBe("");
  } finally {
    if (previous === undefined) delete process.env.SWARMCREWS_BROWSER_HOST_SECRET; else process.env.SWARMCREWS_BROWSER_HOST_SECRET = previous;
    await rm(cwd, { recursive: true, force: true });
  }
}, 120000);
