import { Router } from "express";
import { mountCoreRoutes } from "./projects/core.ts";
import { mountSettingsRoutes } from "./projects/settings.ts";
import { mountFileRoutes } from "./projects/files.ts";
import { mountProjectPathRoutes } from "./projects/paths.ts";
import { mountProjectActivityRoute } from "./projects/activity.ts";
import type { ProjectActivitySummary } from "../../shared/project-activity.ts";

export function createProjectRoutes(deps?: {
  activitySummary: (projectIds: string[]) => ProjectActivitySummary[];
}): Router {
  const router = Router();

  if (deps) mountProjectActivityRoute(router, deps.activitySummary);
  mountProjectPathRoutes(router);
  mountCoreRoutes(router);
  mountSettingsRoutes(router);
  mountFileRoutes(router);

  return router;
}
