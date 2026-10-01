import { agentMessagePreview } from "./agent-message-format.ts";
import { activityStatusLabel, isActivityWorking, isSessionTitleEcho, needsAttention,
  sessionDisplayTitle, type MobileSessionInfo } from "./mobile/mobile-selectors.ts";

export const BRIEFING_DAY = 24 * 60 * 60 * 1000;
export type BriefingGroup = "input" | "outcome" | "resume";
export interface BriefingEntry {
  id: string;
  sessionKey: string;
  title: string;
  group: BriefingGroup;
  label: string;
  detail: string;
  at: number | null;
  signature: string;
  changesAvailable: boolean;
}
export interface BriefingVisit {
  version: 1;
  at: number;
  signatures: Record<string, string>;
}

function identity(session: MobileSessionInfo): string {
  return session.workItemId ? `work:${session.workItemId}` : `session:${session.sessionKey}`;
}

/** Canonical work items own their context; child runs must not become duplicate updates. */
export function briefingWork(sessions: MobileSessionInfo[]): MobileSessionInfo[] {
  const items = new Map<string, MobileSessionInfo>();
  for (const session of sessions) {
    if (session.role === "minion" || session.runKind === "child") continue;
    const id = identity(session);
    const previous = items.get(id);
    if (!previous || (session.canonicalWorkItem && !previous.canonicalWorkItem)
      || (Boolean(session.canonicalWorkItem) === Boolean(previous.canonicalWorkItem)
        && (session.lastActivityAt ?? 0) > (previous.lastActivityAt ?? 0))) items.set(id, session);
  }
  return [...items.values()];
}

/** Non-security digest: visit storage needs change detection, not copies of agent/user text. */
function digest(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

/** Display-only excerpt: keep the original normalized report in the visit signature. */
function briefingPreview(text: string): string {
  const plain = text
    .replace(/^\s*(```|~~~).*$/gm, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/^\s*\[[ xX]\]\s+/gm, "")
    .replace(/! ?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(`+)(.*?)\1/g, "$2")
    .replace(/(\*\*|__|~~)(.*?)\1/g, "$2")
    .replace(/(^|\W)([*_])([^\n]+?)\2(?=\W|$)/g, "$1$3")
    .replace(/\s+/g, " ").trim();
  if (plain.length <= 180) return plain;
  const excerpt = plain.slice(0, 179);
  const boundary = excerpt.lastIndexOf(" ");
  return `${excerpt.slice(0, boundary > 120 ? boundary : 179).trimEnd()}…`;
}

function entryFor(session: MobileSessionInfo): BriefingEntry | null {
  const lifecycle = session.reviewLifecycle;
  const presentation = session.workItemPresentation;
  if (lifecycle?.dismissedAt != null || presentation?.badge === "archived"
    || presentation?.badge === "active" || isActivityWorking(session)) return null;
  // A reviewed failure also has a success-colored presentation badge. It is not a completion.
  if (presentation?.badge === "success" && !session.reviewableChanges
    && ["error_to_review", "interrupted_to_review"].includes(lifecycle?.reviewState ?? "")) return null;
  const pendingState = lifecycle?.acknowledgedAt == null ? lifecycle?.reviewState : "none";
  let group: BriefingGroup;
  let label: string;
  if (presentation?.badge === "attention" || (!presentation && (pendingState === "decision_needed"
    || (needsAttention(session) && (session.status === "waiting" || session.pendingAttention))))) {
    group = "input";
    label = presentation ? activityStatusLabel(session) : "Input requested";
  } else if (presentation?.badge === "error" || (!presentation && (session.status === "error"
    || pendingState === "error_to_review"))) {
    group = "resume";
    label = presentation ? activityStatusLabel(session) : "Error reported";
  } else if ((!presentation && (pendingState === "interrupted_to_review" || ["stopped", "disconnected"].includes(session.status)))
    || (presentation?.badge === "neutral" && presentation.needsAttention && pendingState === "interrupted_to_review")) {
    group = "resume";
    label = presentation ? activityStatusLabel(session) : "Work interrupted";
  } else if (presentation?.badge === "success" || (!presentation && (session.status === "completed"
    || pendingState === "completion_to_review")) || session.reviewableChanges) {
    group = "outcome";
    const completed = presentation ? lifecycle?.reviewState === "completion_to_review"
      : session.status === "completed" || pendingState === "completion_to_review";
    label = completed ? "Reported complete" : session.reviewableChanges ? "Changes available" : "Outcome recorded";
  } else return null;

  const candidates = group === "outcome"
    ? [lifecycle?.finalReport, session.lastActivity, lifecycle?.reviewReason]
    : [lifecycle?.reviewReason, session.lastActivity];
  const source = candidates.find(value => value?.trim() && !isSessionTitleEcho(session, value)
    && (!presentation || value.trim() !== presentation.label));
  const detail = source ? agentMessagePreview(source).replace(/\s+/g, " ").trim() : "";
  // Deliberately exclude chatter timestamps, review acknowledgments and dashboard revisions.
  const signature = digest(JSON.stringify([group, label, detail, !!session.reviewableChanges,
    session.runKey ?? session.sessionKey, session.canonicalWorkItem ? null : lifecycle?.terminalAt]));
  const at = group === "input" ? session.lastActivityAt : lifecycle?.terminalAt ?? session.lastActivityAt;
  return { id: identity(session), sessionKey: session.sessionKey, title: sessionDisplayTitle(session),
    group, label, detail: briefingPreview(source ? agentMessagePreview(source) : ""),
    at: typeof at === "number" && Number.isFinite(at) && at > 0 ? at : null,
    signature, changesAvailable: session.reviewableChanges === true };
}

export function briefingEntries(sessions: MobileSessionInfo[]): BriefingEntry[] {
  return briefingWork(sessions).flatMap(session => {
    const entry = entryFor(session);
    return entry ? [entry] : [];
  });
}

export function captureBriefing(sessions: MobileSessionInfo[], at: number): BriefingVisit {
  const items = briefingWork(sessions).sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)).slice(0, 1000);
  return { version: 1, at, signatures: Object.fromEntries(items.map(session =>
    [identity(session), entryFor(session)?.signature ?? ""])) };
}

/** Compare states we actually saw; for unseen work require a timestamp within the window. */
export function selectBriefingChanges(entries: BriefingEntry[], visit: BriefingVisit | null, since: number): BriefingEntry[] {
  return entries.filter(entry => {
    if (visit && Object.hasOwn(visit.signatures, entry.id)) return visit.signatures[entry.id] !== entry.signature;
    return entry.at != null && entry.at > (visit?.at ?? since);
  }).sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || a.id.localeCompare(b.id));
}

export function parseBriefingVisit(raw: string | null, now: number): BriefingVisit | null {
  try {
    const value = JSON.parse(raw ?? "null") as BriefingVisit | null;
    if (!value || value.version !== 1 || !Number.isFinite(value.at) || value.at <= 0 || value.at > now
      || !value.signatures || typeof value.signatures !== "object" || Array.isArray(value.signatures)) return null;
    const entries = Object.entries(value.signatures);
    if (entries.length > 1000 || entries.some(([key, signature]) => key.length > 512
      || !(key.startsWith("work:") || key.startsWith("session:"))
      || typeof signature !== "string" || !/^[a-f0-9]{0,8}$/.test(signature))) return null;
    return value;
  } catch { return null; }
}
