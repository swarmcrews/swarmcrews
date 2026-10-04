import { useRef, useState } from "react";
import { checkProjectGit, createProject, openProject, type ProjectGitAction } from "../api.ts";
import { useProjectOperation } from "./use-project-operation.ts";

export type ProjectInitialization = { mode: "open" | "create"; path: string; name?: string };
export function useProjectInitialization(onOpenProject: (id: string, path: string, acknowledgement?: string) => void) {
  const operation = useProjectOperation();
  const [gitDecision, setGitDecision] = useState<ProjectInitialization | null>(null);
  const lastDecision = useRef<ProjectInitialization | null>(null);
  const initialize = async (decision: ProjectInitialization, gitAction?: ProjectGitAction) => {
    if (operation.pending) return;
    lastDecision.current = decision;
    const result = await operation.run(async () => {
      setGitDecision(null);
      // Retry always rechecks Git. Destructive initialization must be chosen again.
      if (!gitAction && !(await checkProjectGit(decision.path)).isRepository) {
        setGitDecision(decision);
        return null;
      }
      return decision.mode === "open"
        ? (gitAction ? openProject(decision.path, gitAction) : openProject(decision.path))
        : (gitAction ? createProject(decision.name ?? "Untitled", decision.path, gitAction) : createProject(decision.name ?? "Untitled", decision.path));
    });
    if (result?.value) {
      if (decision.mode === "create") onOpenProject(result.value.id, result.value.path, "Project registered.");
      else onOpenProject(result.value.id, result.value.path);
    }
  };
  return {
    creating: operation.pending, state: operation.state, gitDecision, initialize,
    retry: () => { if (lastDecision.current) void initialize(lastDecision.current); },
    clear: () => { operation.clear(); setGitDecision(null); },
  };
}
