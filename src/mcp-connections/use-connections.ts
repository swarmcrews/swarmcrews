import { useCallback, useContext, useEffect, useState } from "react";
import { ChatLinkContext } from "../components/ChatLink.tsx";
import { listProjectMcpServers } from "../api.ts";
import type { McpServerEntry } from "../../shared/mcp-servers/types.ts";

export function useConnections(projectId?: string | null) {
  const context = useContext(ChatLinkContext);
  const project = projectId ?? context?.project;
  const [state, setState] = useState<{ project: string; entries: McpServerEntry[]; error: string }>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!project) return;
    let active = true;
    let generation = 0;
    const load = async () => {
      const request = ++generation;
      try {
        const result = await listProjectMcpServers(project);
        if (active && request === generation) setState({ project, entries: result.entries, error: result.invalid.length ? "Some saved connections could not be read. Review Connections settings." : "" });
      } catch { if (active && request === generation) setState({ project, entries: [], error: "Couldn't load connections. Try again." }); }
    };
    void load();
    const changed = (event: Event) => { if ((event as CustomEvent).detail?.projectId === project) void load(); };
    window.addEventListener("project-connections-changed", changed);
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("project-connections-changed", changed); window.removeEventListener("focus", load); };
  }, [project, revision]);
  return { project, entries: state?.project === project ? state?.entries ?? [] : [],
    error: state?.project === project ? state?.error ?? "" : "", loaded: Boolean(project && state?.project === project), refresh };
}
