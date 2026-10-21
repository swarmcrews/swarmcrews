import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import type { LibraryUnread } from "../../shared/project-library/index.ts";
import { acknowledgeAll } from "./api.ts";
import { LibraryDialog } from "./LibraryDialog.tsx";
import { LibraryNotice } from "./LibraryNotice.tsx";
import { plural } from "./update-format.ts";

/** Library-wide unread summary with one explicit, confirmed clear. Reviews, decisions and conflicts are never resolved by it. */
export function UpdatesBar({ unread, onCleared }: { unread: LibraryUnread; onCleared: (cleared: number) => void }) {
  const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const updates = plural(unread.total, "unread update"); const projects = plural(unread.projects, "project");
  const clear = async () => {
    setBusy(true); setError(null);
    try { const { cleared } = await acknowledgeAll({ asOf: unread.asOf }); setConfirming(false); onCleared(cleared); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn’t mark updates read"); }
    finally { setBusy(false); }
  };
  return <>
    <section className="pl-updates-bar" aria-label="Unread updates">
      <Bell className="pl-updates-bar-icon" size={16} aria-hidden="true" />
      <p><strong>{updates}</strong> across {projects}</p>
      <button type="button" onClick={() => { setError(null); setConfirming(true); }}><CheckCheck size={16} aria-hidden="true" />Mark all read</button>
    </section>
    {confirming && <LibraryDialog title="Mark all updates read?" busy={busy} onClose={() => setConfirming(false)} footer={<>
      <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
      <button className="pl-action--primary" type="button" disabled={busy} onClick={() => void clear()}>{busy ? "Marking…" : `Mark ${unread.total} read`}</button>
    </>}>
      <p>{updates[0]!.toUpperCase() + updates.slice(1)} across {projects} will be marked read.</p>
      <p className="pl-hint">Decisions, reviews and conflicts are not resolved by this; they stay under Needs attention. Updates that arrive after now stay unread.</p>
      {error && <LibraryNotice tone="error" alert>{error}</LibraryNotice>}
    </LibraryDialog>}
  </>;
}
