import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, request, type Server } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createPackagedStatic } from "./packaged-static.ts";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});
async function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), "packaged-static-")); roots.push(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>Swarmcrews</title>");
  writeFileSync(join(root, "assets", "app-abcdefgh.js"), "console.log('app');");
  const app = express(); app.use(createPackagedStatic(enabled ? root : undefined));
  app.get("/api/check", (_req, res) => res.json({ api: true }));
  const server = createServer(app); servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return (pathname: string, host = `127.0.0.1:${port}`, method = "GET") => new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: pathname, method, headers: { host } }, res => {
      let body = ""; res.on("data", chunk => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    }); req.on("error", reject); req.end();
  });
}
describe("packaged frontend", () => {
  it("serves UI and mobile routes with security headers and no HTML caching", async () => {
    const get = await fixture();
    for (const route of ["/", "/m", "/m/settings"]) {
      const response = await get(route);
      expect(response.status).toBe(200); expect(response.body).toContain("Swarmcrews");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect((await get("/assets/app-abcdefgh.js")).headers["cache-control"]).toContain("immutable");
  });
  it("never shadows APIs or serves files from outside the web root", async () => {
    const get = await fixture();
    expect((await get("/api/check")).body).toBe('{"api":true}');
    for (const route of ["/../package.json", "/%2e%2e/package.json", "/.env", "/missing.js", "/ws", "/api/missing"]) {
      expect((await get(route)).status).toBe(404);
    }
    expect((await get("/", "localhost", "POST")).status).toBe(404);
  });
  it("rejects untrusted Host headers and leaves source serving unchanged", async () => {
    expect((await (await fixture())("/", "attacker.example")).status).toBe(403);
    expect((await (await fixture(false))("/")).status).toBe(404);
  });
});
