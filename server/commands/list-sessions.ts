/**
 * list_sessions — broadcast the registry snapshot to the requesting client.
 */

import { setConnectionProject, connectionProject, connectionInventory, indexSessionProjects } from "../session-subscriptions.ts";
import { unicast } from "../bus.ts";
import type { CommandHandler } from "./types.ts";

export const listSessions: CommandHandler = (ctx, cmd, ws) => {
  const projectId = cmd.projectId === undefined ? connectionProject(ws) : cmd.projectId;
  setConnectionProject(ws, projectId);
  const sessions = ctx.registry.snapshot({ includeArchived: cmd.includeArchived === true });
  indexSessionProjects(sessions);
  unicast(ws, projectId ? `project:${projectId}` : "global", {
    type: "session_list",
    includeArchived: cmd.includeArchived === true,
    sessions: connectionInventory(ws, sessions),
  });
};
