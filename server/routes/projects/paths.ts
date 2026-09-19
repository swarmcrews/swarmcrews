import type { Request, Response, Router } from "express";
import { isAllowedDevHost, isAllowedOrigin } from "../../network-access.ts";
import { discoverRepositoryDirectories } from "../../repository-directory-discovery.ts";

let activeRequests = 0;
const MAX_ACTIVE_REQUESTS = 4;

function trustedRequest(req: Request): boolean {
  if (!isAllowedDevHost(req.hostname)) return false;
  const origin = req.get("origin");
  if (!origin) return true;
  if (!isAllowedOrigin(origin)) return false;
  try { return new URL(origin).hostname.toLowerCase() === req.hostname.toLowerCase(); } catch { return false; }
}

export function mountProjectPathRoutes(router: Router): void {
  router.post("/path-suggestions", async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    if (!trustedRequest(req)) { res.status(403).json({ error: "Untrusted origin or host" }); return; }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Invalid repository path request" }); return;
    }
    const body = req.body as { path?: unknown; mode?: unknown };
    if ((body.path !== undefined && typeof body.path !== "string")
      || (typeof body.path === "string" && body.path.length > 32_768)
      || (body.mode !== undefined && body.mode !== "browse" && body.mode !== "complete")) {
      res.status(400).json({ error: "Invalid repository path request" }); return;
    }
    if (activeRequests >= MAX_ACTIVE_REQUESTS) {
      res.status(429).json({ error: "Folder browser is busy; try again shortly" }); return;
    }
    activeRequests++;
    // A slow network volume cannot hold an HTTP request indefinitely. Keep its
    // admission slot until the underlying filesystem work actually settles.
    const work = discoverRepositoryDirectories({ path: body.path, mode: body.mode })
      .finally(() => { activeRequests--; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), 2_000); });
    try {
      const result = await Promise.race([work, timeout]);
      if (result === "timeout") { res.status(503).json({ error: "Folder lookup timed out; try another location" }); return; }
      if (!result) { res.status(403).json({ error: "Folder is unavailable or outside configured browse roots" }); return; }
      res.json(result);
    } catch {
      res.status(503).json({ error: "Folder lookup is unavailable" });
    } finally { clearTimeout(timer); }
  });
}
