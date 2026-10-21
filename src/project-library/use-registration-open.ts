import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "../api.ts";
import { getLibrary } from "./api.ts";
/** Duplicate registration retains identity; archived membership needs explicit restore, not a hidden organization write. */
export function useRegistrationOpen(onOpen: (id: string, path: string, acknowledgement?: string, registered?: ProjectSummary) => void) {
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const open = useCallback((id: string, path: string, acknowledgement?: string, registered?: ProjectSummary) => {
    setNotice(null);
    void getLibrary().then(library => {
      if (!active.current) return;
      const project = library.projects.find(p => p.id === id);
      if (project?.archived) { setNotice(`“${project.name}” is already registered and archived. Open Archived, then explicitly restore it to Library. Files and history are unchanged.`); return; }
      if (registered) onOpen(id, path, acknowledgement, registered);
      else if (acknowledgement !== undefined) onOpen(id, path, acknowledgement);
      else onOpen(id, path);
    }).catch(() => { if (active.current) setNotice("Registration succeeded, but Library status could not be checked. Refresh Library and open the registered project; registering again is not needed."); });
  }, [onOpen]);
  const dismiss = useCallback(() => setNotice(null), []);
  return { open, notice, dismiss };
}
