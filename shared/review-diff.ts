/** Read-only, bounded review evidence. Never an integration/approval authority. */
export interface ReviewPatch {
  state: "text" | "binary" | "large" | "unavailable";
  text?: string;
  reason?: string;
}
export interface ReviewFile {
  file: string;
  previousFile?: string;
  insertions: number;
  deletions: number;
  status: "added" | "modified" | "deleted" | "renamed";
  patch?: ReviewPatch;
}
export interface ReviewSnapshot {
  /** Fingerprint of returned evidence; not a durable contribution identity. */
  id: string;
  capturedAt: number;
  baseSha: string | null;
  headSha: string | null;
  scope: "workspace" | "worktree";
  runKey?: string;
  contributionBinding: "unbound" | "bound" | "lineage";
  consistency: "sampled" | "immutable";
  contributionId?: string;
  contributionRevision?: number;
  lineageId?: string;
  lineageRevision?: number;
}
export interface ReviewDiff {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: ReviewFile[];
  commits: string[];
  branch: string;
  snapshot?: ReviewSnapshot;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
export function isReviewDiff(value: unknown): value is ReviewDiff {
  if (!record(value) || !count(value["filesChanged"]) || !count(value["insertions"]) || !count(value["deletions"])
    || typeof value["branch"] !== "string" || !Array.isArray(value["commits"]) || !value["commits"].every(c => typeof c === "string")
    || !Array.isArray(value["files"]) || value["files"].length > 10_000 || value["filesChanged"] !== value["files"].length) return false;
  if (!value["files"].every(f => record(f) && typeof f["file"] === "string" && count(f["insertions"]) && count(f["deletions"])
    && ["added", "modified", "renamed", "deleted"].includes(String(f["status"]))
    && (f["previousFile"] === undefined || typeof f["previousFile"] === "string")
    && (f["patch"] === undefined || (record(f["patch"]) && ["text", "binary", "large", "unavailable"].includes(String(f["patch"]["state"]))
      && (f["patch"]["text"] === undefined || (typeof f["patch"]["text"] === "string" && f["patch"]["text"].length <= 65536 && f["patch"]["text"].split("\n").length <= 2000))
      && (f["patch"]["state"] !== "text" || typeof f["patch"]["text"] === "string")
      && (f["patch"]["reason"] === undefined || typeof f["patch"]["reason"] === "string"))))) return false;
  let bytes = 0;
  let lines = 0;
  for (const file of value["files"]) {
    const text = file["patch"]?.["text"] ?? "";
    bytes += new TextEncoder().encode(text).byteLength;
    lines += text ? text.split("\n").length : 0;
    if (bytes > 1024 * 1024 || lines > 10_000) return false;
  }
  if (value["snapshot"] === undefined) return true;
  const s = value["snapshot"];
  return record(s) && typeof s["id"] === "string" && /^sha256:[a-f0-9]{64}$/.test(s["id"]) && count(s["capturedAt"])
    && (s["baseSha"] === null || typeof s["baseSha"] === "string") && (s["headSha"] === null || typeof s["headSha"] === "string")
    && ["workspace", "worktree"].includes(String(s["scope"]))
    && ((s["contributionBinding"] === "unbound" && s["consistency"] === "sampled"
      && s["contributionId"] === undefined && s["contributionRevision"] === undefined && s["lineageId"] === undefined && s["lineageRevision"] === undefined)
      || (s["contributionBinding"] === "bound" && s["consistency"] === "immutable" && s["scope"] === "worktree"
        && typeof s["contributionId"] === "string" && s["contributionId"].length > 0
        && typeof s["lineageId"] === "string" && s["lineageId"].length > 0
        && s["lineageRevision"] === undefined && count(s["contributionRevision"]) && Number.isInteger(s["contributionRevision"])
        && typeof s["baseSha"] === "string" && /^[a-f0-9]{40,64}$/.test(s["baseSha"])
        && typeof s["headSha"] === "string" && /^[a-f0-9]{40,64}$/.test(s["headSha"])
        && typeof s["runKey"] === "string" && s["runKey"].length > 0)
      || (s["contributionBinding"] === "lineage" && s["consistency"] === "immutable" && s["scope"] === "worktree"
        && s["contributionId"] === undefined && s["contributionRevision"] === undefined && s["runKey"] === undefined
        && typeof s["lineageId"] === "string" && s["lineageId"].length > 0
        && count(s["lineageRevision"]) && Number.isInteger(s["lineageRevision"])
        && typeof s["baseSha"] === "string" && /^[a-f0-9]{40,64}$/.test(s["baseSha"])
        && typeof s["headSha"] === "string" && /^[a-f0-9]{40,64}$/.test(s["headSha"])))
    && (s["runKey"] === undefined || typeof s["runKey"] === "string");
}
