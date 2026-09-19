import type { Router } from "express";
import { taskGraphExperimentSettingsSchema } from "../../../shared/task-graph-experiments.ts";
import type { Request, Response } from "express";
import {
  readContext,
  writeContext,
  readSettings,
  writeSettings,
  readSkills,
  writeSkills,
} from "../../project-store.ts";
import type { ProjectSettings } from "../../project-store.ts";
import { mountConnectionRoutes } from "../../mcp-connections/routes.ts";
import { param, resolveProjectReference } from "./helpers.ts";
import { validateContextActionList } from "../../../shared/context-actions.ts";

export function mountSettingsRoutes(router: Router): void {

  router.get("/:encodedPath/context", (req: Request, res: Response) => {
    const projectPath = resolveProjectReference(param(req, "encodedPath"));
    if (!projectPath) {
      res.status(403).json({ error: "Project path not registered" });
      return;
    }
    res.json(readContext(projectPath));
  });

  router.put("/:encodedPath/context", (req: Request, res: Response) => {
    const projectPath = resolveProjectReference(param(req, "encodedPath"));
    if (!projectPath) {
      res.status(403).json({ error: "Project path not registered" });
      return;
    }
    const { content } = req.body as { content: string };
    writeContext(projectPath, content);
    res.json({ ok: true });
  });

  router.get("/:encodedPath/settings", (req: Request, res: Response) => {
    const projectPath = resolveProjectReference(param(req, "encodedPath"));
    if (!projectPath) {
      res.status(403).json({ error: "Project path not registered" });
      return;
    }
    res.json(readSettings(projectPath));
  });

  router.put("/:encodedPath/settings", (req: Request, res: Response) => {
    const projectPath = resolveProjectReference(param(req, "encodedPath"));
    if (!projectPath) {
      res.status(403).json({ error: "Project path not registered" });
      return;
    }
    if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
      res.status(400).json({ error: "Settings must be an object" });
      return;
    }
    const settings = req.body as ProjectSettings;
    if (Object.hasOwn(settings, "taskGraphExperiments")) {
      const flags = taskGraphExperimentSettingsSchema.safeParse(settings.taskGraphExperiments);
      if (!flags.success) { res.status(400).json({ error: "Invalid Task Graph experiments", issues: flags.error.issues }); return; }
      settings.taskGraphExperiments = flags.data;
    }
    if (Object.prototype.hasOwnProperty.call(settings, "dashboardLeaderActions")) {
      const validation = validateContextActionList(settings.dashboardLeaderActions);
      if (!validation.actions) {
        res.status(400).json({
          error: "Invalid Context Actions",
          issues: validation.issues,
        });
        return;
      }
      settings.dashboardLeaderActions = validation.actions;
    }
    writeSettings(projectPath, settings);
    res.json({ ok: true });
  });

  router.get("/:encodedPath/skills", (req: Request, res: Response) => {
    const projectPath = resolveProjectReference(param(req, "encodedPath"));
    if (!projectPath) {
      res.status(403).json({ error: "Project path not registered" });
      return;
    }
    res.json(readSkills(projectPath));
  });

  router.put("/:encodedPath/skills", (req: Request, res: Response) => {
    const projectPath = resolveProjectReference(param(req, "encodedPath"));
    if (!projectPath) {
      res.status(403).json({ error: "Project path not registered" });
      return;
    }
    const skills = req.body as unknown[];
    if (!Array.isArray(skills)) {
      res.status(400).json({ error: "Expected an array of skills" });
      return;
    }
    writeSkills(projectPath, skills);
    res.json({ ok: true });
  });

  mountConnectionRoutes(router);
}
