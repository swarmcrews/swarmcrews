import { useCallback, useEffect, useRef, useState } from "react";
import { getProjectSettings, updateProjectSettings, type ProjectSettings } from "../api.ts";
import type { SettingsSaveState } from "../ContextActionsSettings.tsx";

/** Serialize full-settings writes and fence results to the current project/load. */
export function useMobileProjectSettings(projectId: string) {
  const [settings, setSettings] = useState<ProjectSettings>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SettingsSaveState>({ status: "idle" });
  const [loadRevision, setLoadRevision] = useState(0);
  const generation = useRef(0);
  const revision = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef<ProjectSettings>({});

  useEffect(() => {
    const current = ++generation.current;
    revision.current = 0;
    queue.current = Promise.resolve();
    setLoading(true);
    setLoadError(null);
    setSaveState({ status: "idle" });
    void getProjectSettings(projectId).then(result => {
      if (generation.current !== current) return;
      latest.current = result;
      setSettings(result);
    }).catch((error: unknown) => {
      if (generation.current === current) setLoadError(error instanceof Error ? error.message : "Could not load settings.");
    }).finally(() => {
      if (generation.current === current) setLoading(false);
    });
    return () => { generation.current++; };
  }, [projectId, loadRevision]);

  const save = useCallback((next: ProjectSettings) => {
    const current = generation.current;
    const edit = ++revision.current;
    latest.current = next;
    setSettings(next);
    setSaveState({ status: "saving" });
    // Finish already-authorized writes even if the user leaves Settings.
    // Each queued request captures its project; only UI results are fenced.
    const request = queue.current.catch(() => undefined).then(() => updateProjectSettings(projectId, next));
    queue.current = request;
    void request.then(() => {
      if (generation.current === current && revision.current === edit) setSaveState({ status: "saved" });
    }).catch((error: unknown) => {
      if (generation.current === current && revision.current === edit) setSaveState({
        status: "error", error: error instanceof Error ? error.message : "Could not save settings.",
      });
    });
  }, [projectId]);
  const retrySave = useCallback(() => save(latest.current), [save]);
  const reload = useCallback(() => setLoadRevision(value => value + 1), []);
  return { settings, loading, loadError, saveState, save, retrySave, reload };
}
