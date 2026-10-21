import { useEffect, useState } from "react";
import { getProjectSkills } from "../api.ts";
import { SettingsPreferences, type SettingsPreferencesProps } from "../SettingsPreferences.tsx";
import type { SkillTemplate } from "../skills/types.ts";

/** Fetch this project's Skills without mutating the app-wide skill registry. */
export function MobileActionSettings({ projectId, ...props }: Omit<SettingsPreferencesProps, "category" | "skills"> & { projectId: string }) {
  const [skills, setSkills] = useState<SkillTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setError(null);
    void getProjectSkills(projectId).then(result => {
      if (current) setSkills(result);
    }).catch((err: unknown) => {
      if (current) setError(err instanceof Error ? err.message : "Could not load project Skills.");
    });
    return () => { current = false; };
  }, [projectId, revision]);
  if (error) return <div className="mob-settings-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>Retry loading Skills</button></div>;
  if (!skills) return <p role="status">Loading project Skills…</p>;
  return <SettingsPreferences {...props} category="actions" skills={skills} />;
}
