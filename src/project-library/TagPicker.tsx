import { Plus, X } from "lucide-react";
import { useId, useRef } from "react";

export const parseTags = (value: string) => value.split(",").map(tag => tag.trim()).filter(Boolean);
export const mergeTags = (tags: string[], input: string) => [...new Set([...tags, ...parseTags(input)])];

/** A pending token belongs to the parent draft, including when Save is clicked before Enter. */
export function TagPicker({ tags, input, suggestions, disabled, onChange, onInput }: {
  tags: string[]; input: string; suggestions: string[]; disabled: boolean;
  onChange: (tags: string[]) => void; onInput: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null); const help = useId();
  const add = (value: string) => { onChange(mergeTags(tags, value)); onInput(""); ref.current?.focus(); };
  const matches = suggestions.filter(tag => !tags.includes(tag) && tag.toLocaleLowerCase().includes(input.trim().toLocaleLowerCase())).slice(0, 6);
  return <fieldset className="pl-tags-editor" disabled={disabled}><legend>Tags</legend>
    <div className="pl-token-field">
      {tags.map(tag => <button className="pl-token" type="button" key={tag} aria-label={`Remove tag ${tag}`} onClick={() => { onChange(tags.filter(t => t !== tag)); ref.current?.focus(); }}>{tag}<X size={14} aria-hidden="true" /></button>)}
      <input ref={ref} aria-label="Add tag" aria-describedby={help} placeholder={tags.length ? "Add tag…" : "Add your first tag…"} value={input} maxLength={500} onChange={e => onInput(e.target.value)} onKeyDown={e => {
        if ((e.key === "Enter" || e.key === ",") && !e.nativeEvent.isComposing) { e.preventDefault(); add(input); }
        if (e.key === "Escape" && input) { e.stopPropagation(); onInput(""); }
      }} />
      {input.trim() && <button type="button" aria-label="Add typed tag" onClick={() => add(input)}><Plus size={16} aria-hidden="true" /></button>}
    </div>
    <p id={help} className="pl-hint">Enter to add a tag. Save also includes what you’re typing.</p>
    {matches.length > 0 && <div className="pl-tag-suggestions" role="group" aria-label="Suggested tags">{matches.map(tag => <button type="button" key={tag} aria-label={`Add tag ${tag}`} onClick={() => add(tag)}><Plus size={12} aria-hidden="true" />{tag}</button>)}</div>}
  </fieldset>;
}
