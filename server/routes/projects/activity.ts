import type { Router } from "express";
import { projectActivityRequestSchema, type ProjectActivitySummary } from "../../../shared/project-activity.ts";

export function mountProjectActivityRoute(
  router: Router, summarize: (projectIds: string[]) => ProjectActivitySummary[],
): void {
  router.post("/activity-summary", (req, res) => {
    const parsed = projectActivityRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Expected up to 100 project IDs" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(summarize([...new Set(parsed.data.projectIds)]));
  });
}
