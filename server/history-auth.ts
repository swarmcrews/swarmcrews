import type { Request, Response } from "express";
const NAME = "swarmcrews_history";
const LEGACY_NAME = "minions_history";
/** Read-only archive navigation needs a scoped HttpOnly credential for ordinary links. */
export function setHistoryCookie(req: Request, res: Response, token: string): void {
  res.cookie(NAME, token, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/api/history" });
}
export function historyCookieToken(req: Request): string | null {
  if (req.method !== "GET" || !req.originalUrl.startsWith("/api/history/")) return null;
  const cookies = req.headers.cookie?.split(";").map(s => s.trim()) ?? [];
  for (const name of [NAME, LEGACY_NAME]) {
    const value = cookies.find(s => s.startsWith(`${name}=`));
    if (value) return value.slice(name.length + 1);
  }
  return null;
}
