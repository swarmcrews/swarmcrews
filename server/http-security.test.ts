import { describe, expect, it } from "vitest";
import express from "express";
import type { IncomingMessage } from "node:http";
import { createExpressFetch } from "../tests/harness/in-process-http.ts";
import { createApiAuthMiddleware, createAuthTokenHandler, createWebSocketVerifier } from "./http-security.ts";

const TOKEN = "security-test-token";

function appFetch() {
  const app = express();
  app.get("/api/auth/token", createAuthTokenHandler(TOKEN));
  app.use("/api", createApiAuthMiddleware(TOKEN));
  app.use("/api", (_req, res) => { res.json({ ok: true }); });
  return createExpressFetch({
    handle: (req, res) => app(req as express.Request, res as express.Response),
  }, "http://localhost");
}

describe("HTTP authentication boundary", () => {
  it("bootstraps local clients without caching credentials", async () => {
    const response = await appFetch()("http://localhost/api/auth/token", { headers: { Host: "localhost" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: TOKEN });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Path=/api/history");
  });

  it.each([undefined, "http://127.attacker.example:3141"])(
    "rejects a loopback-looking DNS Host with Origin %s", async (origin) => {
      const response = await appFetch()("http://localhost/api/auth/token", {
        headers: { Host: "127.attacker.example:3141", ...(origin ? { Origin: origin } : {}) },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).not.toContain(TOKEN);
    },
  );

  it("preserves matching trusted proxy requests and rejects mismatched origins", async () => {
    const fetch = appFetch();
    const headers = { Host: "workstation.tailnet.ts.net", Origin: "https://workstation.tailnet.ts.net" };
    expect((await fetch("http://localhost/api/auth/token", { headers })).status).toBe(200);
    expect((await fetch("http://localhost/api/auth/token", {
      headers: { ...headers, Origin: "https://other.tailnet.ts.net" },
    })).status).toBe(403);
  });

  it("keeps bearer authentication mandatory for project and mutation APIs", async () => {
    const fetch = appFetch();
    const cookie = `swarmcrews_history=${TOKEN}`;
    const rejectedHeaders: Record<string, string>[] = [{}, { Cookie: cookie }, { Authorization: "Bearer wrong" }];
    for (const headers of rejectedHeaders) {
      expect((await fetch("http://localhost/api/projects", { headers })).status).toBe(401);
    }
    expect((await fetch("http://localhost/api/projects", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })).status).toBe(200);
    expect((await fetch("http://localhost/api/history/run", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await fetch("http://localhost/api/history/run", {
      method: "POST", headers: { Cookie: cookie },
    })).status).toBe(401);
  });
});

describe("WebSocket handshake authentication", () => {
  const verify = createWebSocketVerifier(TOKEN);
  const info = (url = `/ws?token=${TOKEN}`, host = "localhost", origin = "") => ({
    origin, req: { url, headers: { host } } as IncomingMessage,
  });

  it("accepts authenticated browser and origin-less CLI connections", () => {
    expect(verify(info())).toBe(true);
    expect(verify(info(`/?token=${TOKEN}`, "localhost", "http://localhost:6173"))).toBe(true);
    expect(verify(info(`/ws?token=${TOKEN}`, "workstation.tailnet.ts.net", "https://workstation.tailnet.ts.net"))).toBe(true);
  });

  it.each(["/ws", "/ws?token=wrong", "http://[", "//[", "\\\\[", "", "/ws?token=%FF"])(
    "rejects an unauthenticated or malformed request target %s without throwing", (target) => {
      expect(verify(info(target))).toBe(false);
    },
  );

  it("does not parse the attacker-controlled Host as a URL base", () => {
    expect(verify(info("/ws?token=wrong", "["))).toBe(false);
  });

  it("rejects untrusted origins even with the correct token", () => {
    expect(verify(info(undefined, undefined, "http://127.attacker.example:3141"))).toBe(false);
    expect(verify(info(undefined, undefined, "https://attacker.example"))).toBe(false);
  });
});
