import { useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { dashboardActionIcon } from "../dashboard-leader-actions.ts";
import { filterSlashCommands, parseSlashQuery, type SlashCommand } from "../nodes/leader/prompt/slash-commands.ts";
import "./launch-prompt.css";

/** Shared touch picker; callers choose placement around their own textarea. */
export function useMobileCommandPicker({ onChange, commands, onSelect, disabled }: {
  onChange: (value: string) => void;
  commands: SlashCommand[];
  onSelect: (command: SlashCommand) => void;
  disabled: boolean;
}) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const matches = filterSlashCommands(commands, query ?? "");
  const open = !disabled && query !== null;
  const activeIndex = Math.min(selectedIndex, Math.max(0, matches.length - 1));
  const select = (command: SlashCommand) => {
    onChange(command.insertText);
    onSelect(command);
    setQuery(null);
    textarea.current?.focus();
  };
  const dismiss = () => {
    setQuery(null);
    textarea.current?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    } else if (matches.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const next = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      setSelectedIndex(next);
      const nextCommand = matches[next];
      if (nextCommand) document.getElementById(`${id}-option-${nextCommand.id}`)?.scrollIntoView?.({ block: "nearest" });
    } else if (event.key === "Enter" && !event.shiftKey && matches[activeIndex]) {
      event.preventDefault();
      select(matches[activeIndex]);
    }
  };

  return {
    inputProps: {
      ref: textarea,
      "aria-controls": open ? `${id}-commands` : undefined,
      "aria-activedescendant": open && matches[activeIndex] ? `${id}-option-${matches[activeIndex].id}` : undefined,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
        onChange(event.currentTarget.value);
        setQuery(parseSlashQuery(event.currentTarget.value));
        setSelectedIndex(0);
      },
      onKeyDown: handleKeyDown,
    },
    close: () => setQuery(null),
    toolbar: (
      <div className="mob-launch-command-toolbar">
        <button type="button" disabled={disabled} aria-expanded={open} aria-controls={open ? `${id}-commands` : undefined}
          onClick={() => { setQuery(open ? null : ""); setSelectedIndex(0); }}>
          / Commands
        </button>
        <span>Project shortcuts</span>
      </div>
    ),
    panel: open && (
      <div className="mob-launch-command-panel" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); dismiss(); }
      }}>
        <div className="mob-launch-command-heading">
          <span>{matches.length} command{matches.length === 1 ? "" : "s"}</span>
          <button type="button" onClick={dismiss} aria-label="Close commands">Close</button>
        </div>
        <div id={`${id}-commands`} role="listbox" aria-label="Leader commands" className="mob-launch-command-list">
          {matches.map((command, index) => {
            const Icon = dashboardActionIcon(command.icon);
            return (
              <button type="button" role="option" key={command.id} id={`${id}-option-${command.id}`}
                aria-selected={index === activeIndex} onClick={() => select(command)}>
                <Icon size={18} aria-hidden="true" />
                <span><strong>{command.label}</strong><small>{command.description}</small></span>
              </button>
            );
          })}
        </div>
        {matches.length === 0 && <p role="status">No matching commands</p>}
      </div>
    )
  };
}
