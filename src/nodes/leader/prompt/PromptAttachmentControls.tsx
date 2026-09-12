import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import type { usePromptAttachments } from "./use-prompt-attachments.ts";
import "./leader-prompt.css";

type Attachments = ReturnType<typeof usePromptAttachments>;

export function PromptAttachmentList({ attachments }: { attachments: Attachments }) {
  if (!attachments.drafts.length) return null;
  return (
    <ul className="leader-prompt-bar__attachments" aria-label="Attached context">
      {attachments.drafts.map(draft => (
        <li key={draft.id}>
          {draft.preview && <img src={draft.preview} alt={draft.filename} />}
          <span>{draft.filename}{!draft.item && !draft.error ? " — Loading…" : ""}
            {draft.error && <span role="alert">{draft.error}</span>}
          </span>
          <button type="button" aria-label={`Remove ${draft.filename}`}
            onClick={() => attachments.remove([draft.id])}><X size={14} /></button>
        </li>
      ))}
    </ul>
  );
}

export function PromptAttachmentPicker({ attachments }: { attachments: Attachments }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <>
    <input ref={inputRef} type="file" multiple hidden aria-label="Image or text attachments"
      accept="image/png,image/jpeg,image/gif,image/webp,text/*,.txt,.md,.mdx,.csv,.json,.jsonl,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.sh,.sql,.log"
      onChange={event => {
        attachments.addFiles(Array.from(event.currentTarget.files ?? []));
        event.currentTarget.value = "";
      }} />
    <button type="button" className="leader-prompt-bar__attach" aria-label="Attach images or text files"
      title="Attach images or text files" onClick={() => inputRef.current?.click()}>
      <Paperclip size={16} aria-hidden="true" />
    </button>
  </>;
}
