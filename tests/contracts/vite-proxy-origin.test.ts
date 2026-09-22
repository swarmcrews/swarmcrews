import { createServer as createHttpServer, request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, loadConfigFromFile, preview, type UserConfig } from "vite";

let root: string;
let config: UserConfig;

beforeAll(async () => {
  const loaded = await loadConfigFromFile({ command: "serve", mode: "test" }, path.resolve("vite.config.ts"));
  if (!loaded) throw new Error("Vite configuration not found");
  root = await mkdtemp(path.join(os.tmpdir(), "swarmcrews-proxy-origin-"));
  config = {
    ...loaded.config, configFile: false, root, plugins: [], logLevel: "silent",
    cacheDir: path.join(root, ".vite"), optimizeDeps: { noDiscovery: true, include: [] },
  };
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe.each(["server", "preview"] as const)("%s API proxy", (mode) => {
  it.each(["127.0.0.1", "localhost", "workstation.example.ts.net"])("preserves matching Host and Origin for %s", async (hostname) => {
    const backend = createHttpServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin }));
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const address = backend.address();
    if (!address || typeof address === "string") throw new Error("Missing backend port");
    const target = `http://127.0.0.1:${address.port}`;
    const configured = config[mode]?.proxy?.["/api"];
    // Substitute only the backend address, preserving Vite's string shorthand
    // semantics so a return to changeOrigin=true reproduces the browser bug.
    const proxy = { "/api": typeof configured === "string" ? target : { ...configured, target } };
    const options = { ...config[mode], proxy, port: 0, host: "127.0.0.1" };
    try {
      const frontend = mode === "server"
        ? await createServer({ ...config, server: { ...options, hmr: false, watch: null } })
        : await preview({ ...config, preview: options });
      try {
        if ("listen" in frontend) await frontend.listen();
        const frontAddress = frontend.httpServer!.address();
        if (!frontAddress || typeof frontAddress === "string") throw new Error("Missing frontend port");
        const host = `${hostname}:${frontAddress.port}`;
        const origin = `http://${host}`;
        // Node's fetch can discard a custom Host header; send it over real HTTP.
        const response = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
          const req = request(`http://127.0.0.1:${frontAddress.port}/api/projects/path-suggestions`, {
            method: "POST", headers: { host, origin },
          }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => resolve({ status: res.statusCode, body }));
            res.on("error", reject);
          });
          req.on("error", reject);
          req.end();
        });
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ host, origin });
      } finally {
        if ("close" in frontend) await frontend.close();
        else await new Promise<void>((resolve, reject) => {
          frontend.httpServer.close(error => error ? reject(error) : resolve());
          frontend.httpServer.closeAllConnections();
        });
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        backend.close(error => error ? reject(error) : resolve());
        backend.closeAllConnections();
      });
    }
  });
});
