import { projectErrorMessage } from "./project-error.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { getProject, type ProjectWithNodes } from "../api.ts";

/** Explicit retry only; cancelled loads cannot hydrate a different workspace. */
export function useProjectLoad(projectId: string, onLoaded: (project: ProjectWithNodes) => void) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(true);
  useEffect(() => {
    let active = true;
    pending.current = true;
    setError(null);
    void getProject(projectId).then(project => {
      if (!active) return;
      onLoaded(project);
      setLoaded(true);
    }).catch((reason: unknown) => {
      if (active) setError(projectErrorMessage(reason));
    }).finally(() => { if (active) pending.current = false; });
    return () => { active = false; };
  }, [projectId, onLoaded, attempt]);
  const retry = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    setAttempt(value => value + 1);
  }, []);
  return { loaded, error, retry };
}
