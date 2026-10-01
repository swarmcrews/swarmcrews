import { useState } from "react";
import type { HtmlArtifactComponent } from "../../../shared/render-dsl.ts";
import { hasFeedbackContent, type FeedbackItem, type FeedbackState } from "./html-feedback.ts";

export const noteLabel = (id: string) => id.split("-")[0]!;
export const isDraftNote = (item: FeedbackItem) => item.status === "ready" || item.status === "reopened";

/** One note at a time: the inspector never grows with the size of the batch. */
export function HtmlFeedbackNotes({ c, state, selectedId, pending, onInspect, onDelete, onStatus }: {
  c: HtmlArtifactComponent; state: FeedbackState; selectedId: string | null; pending: boolean;
  onInspect: (item: FeedbackItem) => void; onDelete: (item: FeedbackItem) => void;
  onStatus: (id: string, status: "verified" | "reopened") => void;
}) {
  const [page, setPage] = useState(() => Math.max(0, state.items.findIndex(i => i.id === selectedId)));
  const index = Math.min(page, Math.max(0, state.items.length - 1));
  const item = state.items[index];
  if (!item) return null;
  const stale = state.captures.find(capture => capture.id === item.captureId)?.html !== c.html;
  const response = Array.isArray(c.feedbackResponses) ? c.feedbackResponses.find(r => r?.id === item.id && typeof r.summary === "string") : undefined;
  const label = noteLabel(item.id);
  const status = !hasFeedbackContent(item) ? "Region · add a note" : item.status === "verified" ? item.verifiedHtml === c.html ? "User verified" : "Verified earlier revision"
    : item.status === "reopened" ? "Reopened" : response ? "Agent addressed" : item.status === "ready" ? "Draft · not submitted" : "Submitted";
  const content = [item.request, item.scope !== "instance" ? `Scope: ${item.scope}` : "", item.acceptance ? `Success: ${item.acceptance}` : "",
    item.preview ? `Text: “${item.preview.before}” → “${item.preview.after}”` : "", response ? `Agent report: ${response.summary}` : ""].filter(Boolean).join("\n\n");
  return <section className="hf-batch" aria-label="Annotation batch">
    <div className="hf-note-navigation">
      <button type="button" aria-label="Previous note" disabled={index === 0} onClick={() => setPage(index - 1)}>←</button>
      <select aria-label="Saved note" value={index} onChange={e => setPage(Number(e.target.value))}>{state.items.map((note, i) => <option key={note.id} value={i}>{noteLabel(note.id)} · {i + 1} of {state.items.length}</option>)}</select>
      <button type="button" aria-label="Next note" disabled={index === state.items.length - 1} onClick={() => setPage(index + 1)}>→</button>
    </div>
    <div className="hf-note-heading"><strong>{label}</strong><span>{status}</span></div>
    <textarea className="hf-saved-content" aria-label="Saved feedback" readOnly value={content} placeholder="Select Edit note to describe what should change in this region." />
    {stale && <p className="hf-help">Earlier revision · needs reattachment before sending. Select an updated target to attach.</p>}
    <div className="hf-actions">
      <button type="button" aria-label={`Inspect note ${label}`} onClick={() => onInspect(item)}>{isDraftNote(item) ? "Edit note" : "Inspect note"}</button>
      {isDraftNote(item) ? <button type="button" aria-label={`Delete note ${label}`} disabled={pending} onClick={() => onDelete(item)}>Delete</button> : <>
        <button type="button" disabled={pending || item.status !== "sent" || !stale} title="Review a later HTML revision before verifying." onClick={() => onStatus(item.id, "verified")}>Verify</button>
        <button type="button" disabled={pending} onClick={() => onStatus(item.id, "reopened")}>Reopen</button>
      </>}
    </div>
  </section>;
}
