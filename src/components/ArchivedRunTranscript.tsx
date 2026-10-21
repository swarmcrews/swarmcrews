import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryWindow } from "../../shared/history.ts";
import { emptySessionStreamState, sessionStreamReducer } from "../session-stream.ts";
import type { ServerMessage } from "../use-socket.ts";
import { SessionTranscript } from "./SessionTranscript.tsx";
import "./run-history-disclosure.css";

type HistoryEvents = NonNullable<Extract<ServerMessage, { type: "sync_response" }>["events"]>;
interface HistoryPage { events: HistoryEvents; history: HistoryWindow }

/** Read immutable history without requiring a hydrated session host. Each click reads one bounded page. */
export function ArchivedRunTranscript({ runKey }: { runKey: string }) {
  // Key the reader so a selection change cannot display another iteration's response.
  return <ArchiveReader key={runKey} runKey={runKey} />;
}

function ArchiveReader({ runKey }: { runKey: string }) {
  const [events, setEvents] = useState<HistoryEvents>([]);
  const [before, setBefore] = useState<number | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async (cursor?: number) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(runKey)}?format=json${cursor === undefined ? "" : `&before=${cursor}`}`,
        { signal: controller.signal });
      if (!response.ok) throw new Error("History request failed");
      const page = await response.json() as HistoryPage;
      if (controller.signal.aborted) return;
      setEvents((current) => {
        const ids = new Set(current.map((event) => event.historyId));
        return [...page.events.filter((event) => !ids.has(event.historyId)), ...current];
      });
      setBefore(page.history.before);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [runKey]);
  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [load]);
  // Replay the accumulated chronological events together so tool/results and
  // streaming blocks split across page boundaries retain their normal grouping.
  const stream = useMemo(() => sessionStreamReducer(emptySessionStreamState(runKey), {
    type: "sync_response", sessionKey: runKey, found: true, events,
  }, `archive-${runKey}`), [events, runKey]);
  return <div className="run-history-archive" aria-busy={loading}>
    {(before != null || error) && <button type="button" disabled={loading}
      onClick={() => void load(before ?? undefined)}>
      {error ? "Retry loading transcript" : "Load earlier messages"}
    </button>}
    {loading && <p role="status">Loading run transcript…</p>}
    {error && <p role="alert">Could not load the saved transcript. Try again.</p>}
    {!loading && !error && events.length === 0 && <p role="status">No saved messages for this iteration.</p>}
    {events.length > 0 && <SessionTranscript messages={stream.messages}
      streamingText={stream.streamingText} streamingThinkingText={stream.streamingThinkingText} autoFollow={false} />}
  </div>;
}
