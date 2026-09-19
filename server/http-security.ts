import type { RequestHandler } from "express";
import type { IncomingMessage } from "node:http";
import { historyCookieToken, setHistoryCookie } from "./history-auth.ts";
import { isAllowedAuthBootstrapRequest, isAllowedOrigin } from "./network-access.ts";
import { serverLogger } from "./logging.ts";

const log = serverLogger.child("http-security");

/** Keep authentication independently testable without starting agent runtimes. */
export function createAuthTokenHandler(authToken: string): RequestHandler {
  return (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (!isAllowedAuthBootstrapRequest({
      hostname: req.hostname,
      remoteAddress: req.socket.remoteAddress,
      origin: Array.isArray(origin) ? origin[0] : origin,
    })) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    setHistoryCookie(req, res, authToken);
    res.json({ token: authToken });
  };
}

export function createApiAuthMiddleware(authToken: string): RequestHandler {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : historyCookieToken(req);
    if (token !== authToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

export function createWebSocketVerifier(authToken: string) {
  return (info: { origin: string; req: IncomingMessage }): boolean => {
    const origin = info.origin ?? info.req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      log.warn("ws_connection_rejected", { cause: "origin" });
      return false;
    }
    let token: string | null;
    try {
      // Upgrade targets are origin-form paths. Do not parse an untrusted Host
      // as a URL base: ws does not catch exceptions thrown by verifyClient.
      const target = info.req.url;
      if (!target?.startsWith("/") || target.startsWith("//") || target.includes("\\") || target.includes("#")) {
        return false;
      }
      token = new URL(target, "http://localhost").searchParams.get("token");
    } catch {
      log.warn("ws_connection_rejected", { cause: "url" });
      return false;
    }
    if (token !== authToken) {
      log.warn("ws_connection_rejected", { cause: "auth" });
      return false;
    }
    return true;
  };
}
