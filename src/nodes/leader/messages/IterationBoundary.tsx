import type { TranscriptBoundary } from "../../../components/SessionTranscript.tsx";
import "../../../components/session-transcript.css";

export function IterationBoundary({ boundary, boundaries, scope, onNavigate }: {
  boundary: TranscriptBoundary;
  boundaries: TranscriptBoundary[];
  scope: string;
  onNavigate?: (() => void) | undefined;
}) {
  const index = boundaries.indexOf(boundary);
  const previous = boundaries[index - 1];
  const next = boundaries[index + 1];
  const anchorId = (target: TranscriptBoundary) => `${scope}-${target.id}`;
  function jump(target: TranscriptBoundary) {
    const element = document.getElementById(anchorId(target));
    element?.scrollIntoView({ block: "start" });
    element?.focus({ preventScroll: true });
    onNavigate?.();
  }
  return <nav className="act-tx-run-boundary" id={anchorId(boundary)} tabIndex={-1}
    aria-label={`${boundary.label} navigation`}>
    <span>{boundary.content}</span>
    <span className="act-tx-run-boundary-line" aria-hidden="true" />
    {previous && <button type="button" aria-label={`Previous: ${previous.label}`}
      onClick={() => jump(previous)}>↑</button>}
    {next && <button type="button" aria-label={`Next: ${next.label}`}
      onClick={() => jump(next)}>↓</button>}
  </nav>;
}
