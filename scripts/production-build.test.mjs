import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
function fixture(fail = false, compilerBin = './bin/tsc.js') {
  const dir = mkdtempSync(join(tmpdir(), 'swarmcrews build spaces '));
  cpSync(new URL('./', import.meta.url), join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  for (const name of ['vite', 'typescript']) {
    const base = join(dir, 'node_modules', name);
    mkdirSync(join(base, 'bin'), { recursive: true });
    writeFileSync(join(base, 'package.json'), JSON.stringify({ name, type: 'module', bin: name === 'vite' ? { vite: './bin/vite.js' } : { tsc: compilerBin }, exports: { '.': './index.js', './package.json': './package.json' } }));
    writeFileSync(join(base, 'index.js'), '');
    writeFileSync(join(base, name === 'vite' ? './bin/vite.js' : compilerBin), `
      import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      appendFileSync('build-order', '${name}\\n');
      if ('${name}' === 'vite') {
        const outIndex = process.argv.indexOf('--outDir');
        const out = outIndex < 0 ? 'dist' : process.argv[outIndex + 1];
        // Match Vite's failure mode: clean output before generating bundles.
        rmSync(out, { recursive: true, force: true });
        mkdirSync(out, { recursive: true });
        if (${fail}) process.exit(17);
        writeFileSync(join(out, 'index.html'), 'fresh');
      }
    `);
  }
  return dir;
}

test('builds latest assets in sequence from a path containing spaces', () => {
  const dir = fixture();
  try {
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist/index.html'), 'stale');
    const result = spawnSync(process.execPath, ['scripts/production-build.mjs'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(dir, 'build-order'), 'utf8'), 'typescript\nvite\n');
    assert.equal(readFileSync(join(dir, 'dist/index.html'), 'utf8'), 'fresh');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('production build uses the declared TypeScript 7 compiler entrypoint', () => {
  const dir = fixture(false, './bin/tsc');
  try {
    const result = spawnSync(process.execPath, ['scripts/production-build.mjs'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(dir, 'build-order'), 'utf8'), 'typescript\nvite\n');
    assert.equal(readFileSync(join(dir, 'dist/index.html'), 'utf8'), 'fresh');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('production build runs the installed TypeScript compiler without a bin shim', { timeout: 15_000 }, () => {
  const dir = fixture();
  try {
    rmSync(join(dir, 'node_modules/typescript'), { recursive: true, force: true });
    symlinkSync(fileURLToPath(new URL('../node_modules/typescript', import.meta.url)), join(dir, 'node_modules/typescript'), 'junction');
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, types: [] }, files: ['entry.ts'] }));
    writeFileSync(join(dir, 'entry.ts'), 'const value: number = 42;');
    const result = spawnSync(process.execPath, ['scripts/production-build.mjs'], { cwd: dir, encoding: 'utf8', timeout: 12_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(join(dir, 'dist/index.html'), 'utf8'), 'fresh');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build failure after output cleaning preserves the serving index and assets', () => {
  const dir = fixture(true);
  try {
    mkdirSync(join(dir, 'dist/assets'), { recursive: true });
    writeFileSync(join(dir, 'dist/index.html'), 'serving index');
    writeFileSync(join(dir, 'dist/assets/old.js'), 'serving asset');
    const result = spawnSync(process.execPath, ['scripts/production-build.mjs'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /production build failed/);
    assert.equal(readFileSync(join(dir, 'dist/index.html'), 'utf8'), 'serving index');
    assert.equal(readFileSync(join(dir, 'dist/assets/old.js'), 'utf8'), 'serving asset');
    assert.equal(readdirSync(dir).some(name => name.startsWith('.swarmcrews-build-')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('actual Vite failure after output cleanup leaves the previous frontend intact', { timeout: 15_000 }, () => {
  const dir = fixture();
  try {
    rmSync(join(dir, 'node_modules/vite'), { recursive: true, force: true });
    symlinkSync(fileURLToPath(new URL('../node_modules/vite', import.meta.url)), join(dir, 'node_modules/vite'), 'junction');
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="/main.js"></script>');
    writeFileSync(join(dir, 'main.js'), 'console.log("new frontend")');
    writeFileSync(join(dir, 'vite.config.mjs'), `export default { plugins: [{ name: 'fail-after-clean', generateBundle() { throw new Error('fixture bundle failure') } }] };`);
    mkdirSync(join(dir, 'dist/assets'), { recursive: true });
    writeFileSync(join(dir, 'dist/index.html'), 'old index');
    writeFileSync(join(dir, 'dist/assets/old.js'), 'old bundle');
    const result = spawnSync(process.execPath, ['scripts/production-build.mjs'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fixture bundle failure/);
    assert.equal(readFileSync(join(dir, 'dist/index.html'), 'utf8'), 'old index');
    assert.equal(readFileSync(join(dir, 'dist/assets/old.js'), 'utf8'), 'old bundle');
    assert.equal(readdirSync(dir).some(name => name.startsWith('.swarmcrews-build-')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('preview compresses and caches hashed assets without caching HTML', { timeout: 15_000 }, async () => {
  const { createServer } = await import('node:net');
  const { once } = await import('node:events');
  const { spawn } = await import('node:child_process');
  const { brotliDecompressSync } = await import('node:zlib');
  const dir = mkdtempSync(join(tmpdir(), 'swarmcrews preview spaces '));
  mkdirSync(join(dir, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'index.html'), '<h1>fresh preview</h1>');
  const content = 'export const value = "lots of content";\n'.repeat(100);
  writeFileSync(join(dir, 'dist', 'assets', 'index-abcdefgh.js'), content);
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  listener.close();
  await once(listener, 'close');
  const cli = new URL('../node_modules/vite/bin/vite.js', import.meta.url);
  const config = new URL('../vite.config.ts', import.meta.url);
  const child = spawn(process.execPath, [fileURLToPath(cli), 'preview', dir, '--config', fileURLToPath(config), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let output = '';
    const ready = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`preview exited ${code}: ${output}`)));
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        output += chunk;
        if (output.includes(`:${port}/`)) resolve();
      });
    });
    await ready;
    const url = `http://127.0.0.1:${port}`;
    // Fetch transparently decompresses bodies, so use raw HTTP to verify
    // actual transferred bytes and response headers.
    const { get } = await import('node:http');
    const request = (path, headers) => new Promise((resolve, reject) => get(url + path, { headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks), status: res.statusCode }));
    }).once('error', reject));
    const asset = await request('/assets/index-abcdefgh.js', { 'Accept-Encoding': 'br' });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers['content-encoding'], 'br');
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(brotliDecompressSync(asset.body).toString(), content);
    const html = await request('/', { 'Accept-Encoding': 'br' });
    assert.equal(html.status, 200);
    assert.notEqual(html.headers['cache-control'], 'public, max-age=31536000, immutable');
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await once(child, 'exit');
    rmSync(dir, { recursive: true, force: true });
  }
});
