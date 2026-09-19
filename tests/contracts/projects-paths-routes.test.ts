import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountProjectPathRoutes } from "../../server/routes/projects/paths.ts";
import { createExpressFetch } from "../harness/in-process-http.ts";

let root: string;
let fetch: typeof globalThis.fetch;
const baseUrl = "http://localhost";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "minions-path-route-"));
  fs.mkdirSync(path.join(root, "repository"));
  vi.stubEnv("SWARMCREWS_BROWSE_ROOTS", JSON.stringify([root]));
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountProjectPathRoutes(router);
  app.use("/api/projects", router);
  fetch = createExpressFetch(app, baseUrl);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("POST /api/projects/path-suggestions", () => {
  it("returns the shared directory shape", async () => {
    const response = await fetch(`${baseUrl}/api/projects/path-suggestions`, {
      method: "POST", headers: { "content-type": "application/json", host: "localhost", origin: baseUrl },
      body: JSON.stringify({ path: root, mode: "browse" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      platform: process.platform === "win32" ? "win32" : "posix",
      roots: [{ path: fs.realpathSync(root) }],
      directory: fs.realpathSync(root),
      entries: [{ name: "repository", path: path.join(fs.realpathSync(root), "repository") }],
      truncated: false,
    });
  });

  it.each([null, [], 42, { path: 42 }, { path: "a".repeat(32_769) }])("rejects malformed body %#", async (body) => {
    const response = await fetch(`${baseUrl}/api/projects/path-suggestions`, {
      method: "POST", headers: { "content-type": "application/json", host: "localhost" }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an untrusted Host and a mismatched trusted Origin", async () => {
    for (const headers of [{ host: "attacker.example" }, { host: "localhost", origin: "http://other.ts.net" }]) {
      const response = await fetch(`${baseUrl}/api/projects/path-suggestions`, {
        method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}",
      });
      expect(response.status).toBe(403);
    }
  });

  it("rejects malformed input and untrusted origins before filesystem discovery", async () => {
    const malformed = await fetch(`${baseUrl}/api/projects/path-suggestions`, {
      method: "POST", headers: { "content-type": "application/json", host: "localhost" }, body: JSON.stringify({ mode: "recursive" }),
    });
    expect(malformed.status).toBe(400);
    const untrusted = await fetch(`${baseUrl}/api/projects/path-suggestions`, {
      method: "POST", headers: { "content-type": "application/json", host: "localhost", origin: "https://example.com" },
      body: JSON.stringify({ mode: "browse" }),
    });
    expect(untrusted.status).toBe(403);
  });
});
