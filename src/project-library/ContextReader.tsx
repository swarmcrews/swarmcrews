import { useEffect, useState } from "react";
import { getProjectContext } from "../api.ts";
import { LibraryDialog } from "./LibraryDialog.tsx";
export function ContextReader({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [retry, setRetry] = useState(0);
  useEffect(() => { let stopped = false; setError(null); void getProjectContext(projectId).then(value => { if (!stopped) setContent(value.content); }).catch(err => { if (!stopped) setError(String(err)); }); return () => { stopped = true; }; }, [projectId, retry]);
  return <LibraryDialog sheet title="Project context" onClose={onClose}><p className="pl-hint">Saved project context. Reading does not mark updates read.</p>{content === null && !error && <p role="status">Loading context…</p>}{error && <p role="alert">{error}<button type="button" onClick={() => setRetry(n => n + 1)}>Retry context</button></p>}{content !== null && <pre className="pl-context">{content || "No saved context."}</pre>}</LibraryDialog>;
}
