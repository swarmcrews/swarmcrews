import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, loadConfigFromFile, preview, type UserConfig } from "vite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";

let root: string;
let config: UserConfig;

beforeAll(async () => {
  const loaded = await loadConfigFromFile({ command: "serve", mode: "test" }, path.resolve("vite.config.ts"));
  if (!loaded) throw new Error("Vite configuration not found");
  root = await mkdtemp(path.join(os.tmpdir(), "swarmcrews-browser-security-"));
  await mkdir(path.join(root, "dist"));
  const html = "<!doctype html><html><body>Security fixture</body></html>";
  await writeFile(path.join(root, "index.html"), html);
  await writeFile(path.join(root, "dist", "index.html"), html);
  config = {
    ...loaded.config, configFile: false, root, plugins: [], logLevel: "silent",
    cacheDir: path.join(root, ".vite"),
    optimizeDeps: { noDiscovery: true, include: [] },
  };
});

afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function expectProtectedDocument(server: Server) {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Security fixture");
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

describe("browser document protection", () => {
  it("protects the actual Vite development response", async () => {
    const server = await createServer({
      ...config,
      server: { ...config.server, port: 0, host: "127.0.0.1", hmr: false, watch: null },
    });
    try {
      await server.listen();
      await expectProtectedDocument(server.httpServer!);
    } finally { await server.close(); }
  });

  it("protects the actual Vite preview response", async () => {
    const server = await preview({
      ...config, preview: { ...config.preview, port: 0, host: "127.0.0.1" },
    });
    try {
      await expectProtectedDocument(server.httpServer);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.httpServer.close(error => { if (error) reject(error); else resolve(); });
        server.httpServer.closeAllConnections();
      });
    }
  });
});
