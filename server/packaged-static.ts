import express, { type RequestHandler } from "express";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isAllowedDevHost } from "./network-access.ts";
import { BROWSER_SECURITY_HEADERS } from "../shared/browser-security-headers.ts";

/** The portable app serves UI/API/WS on one port, without Vite or a proxy.
 * Source launches keep their existing Vite path. Never expose the app tree. */
export function createPackagedStatic(root: string | undefined = process.env["SWARMCREWS_PACKAGED"] === "1"
  ? fileURLToPath(new URL("../web/", import.meta.url)) : undefined): RequestHandler {
  if (!root) return (_req, _res, next) => next();
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/") || req.path === "/ws") return next("router");
    if (!isAllowedDevHost(req.hostname)) { res.sendStatus(403); return; }
    res.set(BROWSER_SECURITY_HEADERS);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(express.static(root, {
    dotfiles: "deny", index: false, redirect: false, cacheControl: false,
    setHeaders(res, file) {
      if (/[\\/]assets[\\/][a-zA-Z0-9_-]+-[a-zA-Z0-9_-]{8,}\.(js|css|svg|json)$/.test(file)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));
  router.get(["/", "/m", "/m/{*path}"], (_req, res) => {
    res.sendFile(join(root, "index.html"), { cacheControl: false });
  });
  return router;
}
