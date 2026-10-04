import type { ReviewDiff, ReviewFile } from "../../../shared/review-diff.ts";
import "../../changes-view.css";

export function FilePatch({ file }: { file: ReviewFile }) {
  const patch = file.patch;
  if (!patch) return <p className="review-patch__notice">Patch not recorded. Refresh to inspect current evidence.</p>;
  if (patch.state !== "text") return <p className="review-patch__notice"><strong>{patch.state === "binary" ? "Binary file" : patch.state === "large" ? "Large file / patch omitted" : "Patch unavailable"}</strong> · {patch.reason ?? "No inline text patch available."}</p>;
  if (!patch.text) return <p className="review-patch__notice">No text hunks. Inspect the file status and rename metadata.</p>;
  return <pre className="review-patch" tabIndex={0} aria-label={`Patch for ${file.file}`}><code>{patch.text.split("\n").map((line, i) => <span key={i} data-kind={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "delete" : line.startsWith("@@") ? "hunk" : "context"}>{line}{"\n"}</span>)}</code></pre>;
}

export function ReviewIdentity({ diff, sessionKey, loading, error }: {
  diff: ReviewDiff | null; sessionKey: string; loading: boolean; error: string | null;
}) {
  const snapshot = diff?.snapshot;
  return <div className="review-identity" role="status">
    {snapshot?.contributionBinding !== "lineage" && <div>Run <code>{snapshot?.runKey ?? sessionKey}</code>{!snapshot?.runKey ? " · requested session; snapshot run not recorded" : ""}</div>}
    {snapshot ? <>
      <div className="review-identity__id">Snapshot <code>{snapshot.id}</code></div>
      <div>Captured {new Date(snapshot.capturedAt).toLocaleString()} · {snapshot.contributionBinding === "lineage" ? "combined lineage" : snapshot.scope === "workspace" ? "shared workspace" : "isolated worktree"}</div>
      <div>Base <code>{snapshot.baseSha ?? "no commit"}</code> · HEAD <code>{snapshot.headSha ?? "no commit"}</code></div>
      <p>{error ? "Retained snapshot — not current. Refresh failed; prior evidence is preserved." : loading ? "Checking for newer changes; retained snapshot is not confirmed current." : snapshot.consistency === "immutable" ? "Immutable committed evidence; later working-tree edits are excluded." : "Sampled working-tree evidence; files may change after capture."}</p>
      {snapshot.contributionBinding === "bound" ? <>
        <div>Contribution <code>{snapshot.contributionId}</code> · revision {snapshot.contributionRevision}</div>
        <div>Lineage <code>{snapshot.lineageId}</code></div>
        <p>Evidence only. Review, gates, enqueue and promotion remain separate actions.</p>
      </> : snapshot.contributionBinding === "lineage" ? <>
        <div>Lineage <code>{snapshot.lineageId}</code> · revision {snapshot.lineageRevision}</div>
        <p>Combined evidence only. Final review, gates and promotion remain separate actions.</p>
      </> : <p>Not bound to an immutable contribution. Inspect integration identity and gates separately; this snapshot grants no approval.</p>}
    </> : <p>{diff ? "Snapshot identity not recorded. Refresh before deciding on these changes." : "No review snapshot loaded yet."}</p>}
  </div>;
}

/** Native disclosures preserve keyboard operation and per-file expansion on refresh. */
export function ReviewFiles({ diff }: { diff: ReviewDiff }) {
  return <div className="changes-card__files review-files" aria-label="Changed files">
    {diff.files.map(file => <details className="review-file" key={file.file}>
      <summary className="review-file__row">
        <span className="review-file__status" data-status={file.status}>{file.status}</span>
        <span className="review-file__path">{file.file}</span>
        {file.patch?.state === "binary" ? <span className="review-file__kind">Binary</span> : file.patch?.state === "large" ? <span className="review-file__kind">Patch omitted</span> : null}
        <span className="review-file__stat"><span className="changes-add">+{file.insertions}</span>{" "}<span className="changes-del">-{file.deletions}</span></span>
      </summary>
      <div className="review-file__detail">
        {file.previousFile ? <p className="review-file__rename">Renamed from <code>{file.previousFile}</code> to <code>{file.file}</code></p> : null}
        <FilePatch file={file} />
      </div>
    </details>)}
  </div>;
}

export function canDecideFromReview(diff: ReviewDiff | null, loading: boolean, error: string | null): boolean {
  return Boolean(diff?.snapshot?.runKey && !loading && !error && diff.filesChanged > 0
    && diff.files.every(file => file.patch && file.patch.state !== "unavailable"));
}
