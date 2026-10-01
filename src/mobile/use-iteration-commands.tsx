import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { getProjectSettings, getProjectSkills, type ProjectSettings } from "../api.ts";
import { invokeContextAction } from "../../shared/context-actions.ts";
import { buildSlashCommands, type SlashCommand } from "../nodes/leader/prompt/slash-commands.ts";
import { compileSkills, type SkillTemplate } from "../skills/types.ts";
import { LaunchSkillsPanel } from "./LaunchSkillsPanel.tsx";

export interface IterationCommandSkills {
  skillIds: string[];
  skillValues: Record<string, Record<string, string>>;
}

export function useIterationCommands(projectId: string | null | undefined, enabled: boolean,
  memory?: { commandSkills?: IterationCommandSkills }) {
  const [catalog, setCatalog] = useState<{ projectId: string | null; settings: ProjectSettings; skills: SkillTemplate[] }>({
    projectId: null, settings: {}, skills: [],
  });
  const [selection, setSelection] = useState<IterationCommandSkills | undefined>(memory?.commandSkills);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useLayoutEffect(() => {
    if (!memory) return;
    if (selection) memory.commandSkills = selection;
    else delete memory.commandSkills;
  }, [memory, selection]);
  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    void Promise.all([
      getProjectSettings(projectId).catch(() => ({})),
      getProjectSkills(projectId).catch(() => []),
    ]).then(([settings, skills]) => {
      if (!cancelled) setCatalog({ projectId, settings, skills });
    });
    return () => { cancelled = true; };
  }, [projectId, enabled]);
  const ready = !projectId || catalog.projectId === projectId;
  const commands = useMemo(() => buildSlashCommands(ready ? catalog.settings : undefined), [catalog.settings, ready]);
  const selectedSkills = catalog.skills.filter((skill) => selection?.skillIds.includes(skill.id));
  const unavailableSkills = (selection?.skillIds ?? []).filter((id) => !catalog.skills.some((skill) => skill.id === id));
  const missingValues = selectedSkills.some((skill) => skill.variables.some((variable) =>
    variable.required && !(selection?.skillValues[skill.id]?.[variable.name] ?? variable.defaultValue ?? "").trim()));
  const select = (command: SlashCommand) => {
    const invocation = invokeContextAction({ prompt: command.insertText, skillIds: command.skillIds ?? [] },
      selection?.skillIds ?? [], catalog.skills.map((skill) => skill.id));
    if (invocation.skillIds.length) setSelection({ skillIds: invocation.skillIds, skillValues: selection?.skillValues ?? {} });
    setNotice(invocation.missingSkillIds.length
      ? `Command inserted. Unavailable skills were not armed: ${invocation.missingSkillIds.join(", ")}.` : null);
  };
  return {
    commands, ready, select,
    blocked: Boolean(selection && (!ready || missingValues || unavailableSkills.length > 0)),
    messageOptions: (prompt: string) => {
      if (!selection) return { prompt };
      const addendum = compileSkills(selectedSkills, selection.skillValues) || "No leader skills are currently active.";
      return { ...selection, prompt: `<system-reminder>\n${addendum}\n</system-reminder>\n\n${prompt}` };
    },
    controls: <>
      {notice && <p className="mob-composer-error" role="status">{notice}</p>}
      {selection && <div className="mob-iteration-skills">
        <button type="button" onClick={() => setEditing(true)}>Command skills ({selection.skillIds.length})</button>
        <button type="button" onClick={() => { setSelection(undefined); setNotice(null); }}>Clear command skills</button>
        {missingValues && <span>Complete required skill fields before sending.</span>}
        {ready && unavailableSkills.length > 0 && <span role="status">Command skills unavailable: {unavailableSkills.join(", ")}. Clear command skills to continue.</span>}
      </div>}
    </>,
    editor: <LaunchSkillsPanel open={editing} availableSkills={catalog.skills} selectedSkillIds={selection?.skillIds ?? []}
      skillValues={selection?.skillValues ?? {}} onClose={() => setEditing(false)}
      onToggleSkill={(id) => setSelection((current) => ({ skillValues: current?.skillValues ?? {},
        skillIds: current?.skillIds.includes(id) ? current.skillIds.filter((selected) => selected !== id) : [...(current?.skillIds ?? []), id] }))}
      onVarChange={(id, name, value) => setSelection((current) => ({ skillIds: current?.skillIds ?? [],
        skillValues: { ...current?.skillValues, [id]: { ...current?.skillValues[id], [name]: value } } }))} />,
  };
}
