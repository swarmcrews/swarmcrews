import { z } from "zod/v4";
import { randomUuid } from "../../random-id.ts";
import type { useDashboardTransport } from "./FormSubmissionProvider.tsx";
import { emptyFeedback, feedbackStateSchema, feedbackMarkdown, hasFeedbackContent, type FeedbackState } from "./html-feedback.ts";

type Transport = NonNullable<ReturnType<typeof useDashboardTransport>>;
const journalSchema = feedbackStateSchema.extend({ outgoing: z.array(z.object({
  id: z.string(), itemIds: z.array(z.string()), itemVersions: z.record(z.string(), z.number()).optional(), status: z.enum(["pending", "accepted", "rejected", "acknowledged"]),
})).default([]), deletedIds: z.array(z.string()).default([]) });
type Journal = z.infer<typeof journalSchema>;
const rank = { pending: 0, acknowledged: 1, rejected: 2, accepted: 3 };
function read(raw: string | null): Journal {
  try { const p = raw ? journalSchema.safeParse(JSON.parse(raw)) : null; if (p?.success) return p.data; } catch { /* preserve working memory */ }
  return { ...emptyFeedback(), outgoing: [], deletedIds: [] };
}
function merge(a: Journal, b: Journal): Journal {
  const captures = new Map(a.captures.map(c => [c.id, c]));
  for (const capture of b.captures) captures.set(capture.id, capture);
  const items = new Map(a.items.map(i => [i.id, i]));
  for (const item of b.items) {
    const old = items.get(item.id);
    if (!old || (item.updatedAt ?? 0) > (old.updatedAt ?? 0) || ((item.updatedAt ?? 0) === (old.updatedAt ?? 0) && JSON.stringify(item) > JSON.stringify(old))) items.set(item.id, item);
  }
  // Deletion is permanent for a note ID: stale tabs must not resurrect it.
  const deletedIds = [...new Set([...a.deletedIds, ...b.deletedIds])];
  for (const id of deletedIds) items.delete(id);
  const outgoing = new Map(a.outgoing.map(r => [r.id, r]));
  for (const r of b.outgoing) if (rank[r.status] >= rank[outgoing.get(r.id)?.status ?? "pending"]) outgoing.set(r.id, r);
  return { captures: [...captures.values()], items: [...items.values()], outgoing: [...outgoing.values()], deletedIds };
}

/** Browser-lifetime session journal. Views subscribe; unmount is not rejection.
 * Each new note has a unique ID, so cross-tab storage events can merge additions.
 * Concurrent edits to the same note use deterministic last-write-wins ordering.
 */
export class HtmlFeedbackStore {
  readonly key: string;
  private journal: Journal;
  private listeners = new Set<() => void>();
  private transport: Transport | null = null;
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private value: { state: FeedbackState; pending: boolean; delivery: string; storageError: string };
  readonly sessionKey: string;
  readonly componentId: string;
  constructor(sessionKey: string, componentId: string) {
    this.sessionKey = sessionKey; this.componentId = componentId;
    this.key = `html-feedback:v1:${sessionKey}:${componentId}`;
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(this.key); } catch { /* export still works */ }
    this.journal = read(raw);
    this.value = { state: this.journal, pending: this.hasPending(), storageError: "", delivery: this.hasPending() ? "Receipt not confirmed. Check the conversation before retrying; notes are preserved." : "" };
    window.addEventListener("storage", e => {
      if (e.key !== this.key || !e.newValue) return;
      const next = merge(this.journal, read(e.newValue));
      if (JSON.stringify(next) !== JSON.stringify(this.journal)) { this.journal = next; this.publish(); }
    });
  }
  private hasPending() { return this.journal.outgoing.some(r => r.status === "pending"); }
  snapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private refresh() {
    try { this.journal = merge(this.journal, read(window.localStorage.getItem(this.key))); } catch { /* working memory survives */ }
  }
  private publish(delivery = this.value.delivery) {
    let storageError = "";
    try { window.localStorage.setItem(this.key, JSON.stringify(this.journal)); }
    catch { storageError = "Browser storage is full or unavailable. Export feedback before leaving."; }
    this.value = { state: { captures: this.journal.captures, items: this.journal.items }, pending: this.hasPending(), delivery, storageError };
    this.listeners.forEach(fn => fn());
    return !storageError;
  }
  update = (updater: (state: FeedbackState) => FeedbackState) => {
    this.refresh();
    if (this.hasPending()) { this.publish(); return; }
    const next = updater(this.journal);
    const deletedIds = [...new Set([...this.journal.deletedIds, ...this.journal.items.filter(i => !next.items.some(n => n.id === i.id)).map(i => i.id)])];
    const now = Math.max(Date.now(), ...this.journal.items.map(i => (i.updatedAt ?? 0) + 1));
    this.journal = { ...next, items: next.items.filter(i => !deletedIds.includes(i.id)).map(i => this.journal.items.includes(i) ? i : { ...i, updatedAt: now }), outgoing: this.journal.outgoing, deletedIds };
    this.publish();
  };
  connect(transport: Transport | null) {
    if (!transport) return;
    const changed = this.transport?.socketSubscribe !== transport.socketSubscribe;
    this.transport = transport;
    if (!changed) return;
    this.unsubscribe?.();
    this.unsubscribe = transport.socketSubscribe?.(this.receive);
    // Deliberately keep the receipt subscription alive across all UI unmounts.
  }
  private receive = (message: unknown) => {
    if (!message || typeof message !== "object") return;
    const m = message as Record<string, unknown>;
    if (m["type"] !== "control_response" || m["command"] !== "send_message" || m["sessionKey"] !== this.sessionKey) return;
    this.refresh();
    const req = this.journal.outgoing.find(r => r.id === m["requestId"]);
    if (!req || req.status === "accepted") return;
    const success = m["success"] === true;
    req.status = success ? "accepted" : "rejected";
    if (!this.hasPending()) clearTimeout(this.timer);
    const updatedAt = Math.max(Date.now(), ...this.journal.items.map(i => (i.updatedAt ?? 0) + 1));
    let newerDrafts = false;
    if (success) this.journal.items = this.journal.items.map(i => {
      if (!req.itemIds.includes(i.id) || !["ready", "reopened"].includes(i.status)) return i;
      // A receipt confirms the submitted version, never later local edits.
      if (req.itemVersions?.[i.id] !== (i.updatedAt ?? 0)) { newerDrafts = true; return i; }
      return { ...i, status: "sent", updatedAt };
    });
    this.publish(success ? newerDrafts ? "Earlier feedback received. Newer or unconfirmed note versions remain drafts; submit them separately." : "Feedback received by the agent. Review the next revision before verifying." : typeof m["error"] === "string" ? m["error"] : "Feedback rejected. Your notes are preserved.");
  };
  send(currentHtml: string) {
    this.refresh();
    if (this.hasPending()) { this.publish("Receipt not confirmed. Check the conversation before retrying; notes are preserved."); return; }
    const t = this.transport;
    if (!t?.socketSend || !t.socketSubscribe || t.connected === false) { this.publish("Not connected to a session. Export feedback or reconnect to send."); return; }
    const items = this.journal.items.filter(i => hasFeedbackContent(i) && ["ready", "reopened"].includes(i.status) && this.journal.captures.some(c => c.id === i.captureId && c.html === currentHtml));
    if (!items.length) { this.publish("No written feedback attached to the current revision. Add a note to a region or select the updated target for follow-up feedback."); return; }
    const req: Journal["outgoing"][number] = { id: randomUuid(), itemIds: items.map(i => i.id), itemVersions: Object.fromEntries(items.map(i => [i.id, i.updatedAt ?? 0])), status: "pending" };
    this.journal.outgoing.push(req);
    // Persist intent BEFORE crossing the socket boundary. Restores remain unconfirmed.
    if (!this.publish("Sending feedback…")) {
      req.status = "rejected";
      this.publish("Cannot save the outgoing receipt marker. Export feedback or free browser storage before retrying.");
      return;
    }
    this.timer = setTimeout(() => this.publish("Receipt not confirmed. Check the conversation before retrying; notes are preserved."), 15000);
    try { t.socketSend({ type: "send_message", sessionKey: this.sessionKey, requestId: req.id,
      prompt: feedbackMarkdown(this.componentId, { ...this.journal, items }), displayPrompt: `HTML feedback for ${this.componentId}: ${items.map(i => i.id).join(", ")}` }); }
    catch { clearTimeout(this.timer); this.publish("Receipt not confirmed. Check the conversation before retrying; notes are preserved."); }
  }
  resetDelivery = () => {
    this.refresh(); clearTimeout(this.timer);
    this.journal.outgoing = this.journal.outgoing.map(r => r.status === "pending" ? { ...r, status: "acknowledged" } : r);
    this.publish("");
  };
}
const stores = new Map<string, HtmlFeedbackStore>();
export function getHtmlFeedbackStore(sessionKey: string, componentId: string) {
  const key = JSON.stringify([sessionKey, componentId]);
  let store = stores.get(key);
  if (!store) { store = new HtmlFeedbackStore(sessionKey, componentId); stores.set(key, store); }
  return store;
}
