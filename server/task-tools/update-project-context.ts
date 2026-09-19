import { PROJECT_CONTEXT_CHAR_LIMIT } from "../../shared/project-context.ts";
import { z } from "zod/v4";
import type { NormalizedToolDef } from "../harness/types.ts";
import { textResult } from "../harness/tool-result.ts";
import { writeContext } from "../project-store.ts";
import { findWorkspaceBySource } from "../workspace-registry.ts";
import type { TaskToolContext } from "./types.ts";

const updateProjectContextInputSchema = z.object({
  content: z.string().trim().min(1).max(100_000).describe(
    `Complete replacement project context as concise, well-structured Markdown. Aim for at most ${PROJECT_CONTEXT_CHAR_LIMIT} characters; larger sources are retained with bounded excerpts in delegated prompts.`,
  ),
});

export function createUpdateProjectContextToolDef(ctx: TaskToolContext): NormalizedToolDef {
  return {
    name: "update_project_context",
    description:
      "Save the project's Context panel by writing AGENTS.md in the project source folder (or agents.md if that is the existing file), creating it if missing. This replaces the complete file, so read and preserve existing instructions when updating it. The saved context is included in subsequently delegated Minion task prompts.",
    inputSchema: updateProjectContextInputSchema,
    handler: async (input: unknown) => {
      const { content } = updateProjectContextInputSchema.parse(input);
      writeContext(ctx.projectPath, content);

      const workspace = findWorkspaceBySource(ctx.projectPath);
      if (!workspace) {
        throw new Error("Project context was written but its registered workspace could not be resolved");
      }
      ctx.bus.emitToProject(workspace.id, {
        type: "project_context_updated",
        projectId: workspace.id,
        content,
        exists: true,
        updatedBySessionKey: ctx.leaderSessionKey,
        timestamp: Date.now(),
      });
      return textResult("Project context updated and available to subsequently delegated Minions.");
    },
  };
}
