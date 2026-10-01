import { useId } from "react";
import type { SlashCommand } from "../nodes/leader/prompt/slash-commands.ts";
import { useMobileCommandPicker } from "./use-mobile-command-picker.tsx";

/** In-flow results stay inside the mobile scroller, including with the keyboard open. */
export function LaunchPrompt({ value, onChange, commands, onSelect, disabled }: {
  value: string;
  onChange: (value: string) => void;
  commands: SlashCommand[];
  onSelect: (command: SlashCommand) => void;
  disabled: boolean;
}) {
  const id = useId();
  const picker = useMobileCommandPicker({ onChange, commands, onSelect, disabled });
  return (
    <div className="mob-launch-field mob-launch-prompt">
      <div className="mob-launch-prompt-heading">
        <label htmlFor={`${id}-prompt`}>Prompt</label>
        <span id={`${id}-count`}>{value.trim().length} characters</span>
      </div>
      <textarea {...picker.inputProps}
        id={`${id}-prompt`}
        aria-describedby={`${id}-count`}
        value={value}
        rows={5}
        placeholder="What should the leader do? Type / for commands"
      />
      {picker.toolbar}
      {picker.panel}
    </div>
  );
}
