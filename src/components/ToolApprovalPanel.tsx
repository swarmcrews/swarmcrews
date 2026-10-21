import { useEffect, useRef, useState } from "react";
import type { ToolApprovalDecision, ToolApprovalRequest } from "../../shared/tool-approval.ts";
import { randomUuid } from "../random-id.ts";
import { subscribeSocketTopics, type ServerMessage, type SocketSubscribeLike } from "../use-socket.ts";
import "./tool-approval-panel.css";

export interface ToolApprovalPanelProps {
  sessionKey: string | null;
  sessionLabel?: string;
  socketSend?: ((data: unknown) => void) | undefined;
  socketSubscribe?: SocketSubscribeLike;
}

/** Every surface uses the live callback snapshot, never historical transcript requests. */
export function ToolApprovalPanel(props: ToolApprovalPanelProps) {
  return <ApprovalSession key={props.sessionKey} {...props} />;
}
function ApprovalSession({ sessionKey, sessionLabel, socketSend, socketSubscribe }: ToolApprovalPanelProps) {
  const [requests, setRequests] = useState<ToolApprovalRequest[]>([]);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState<Record<string, string>>({});
  const pending = useRef<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const refresh = () => socketSend?.({ type: "get_tool_approvals", sessionKey });
  useEffect(() => {
    if (!sessionKey || !socketSend || !socketSubscribe) return;
    const update = (items: ToolApprovalRequest[]) => {
      setRequests(items.filter(item => item.sessionKey === sessionKey && item.expiresAt > Date.now()));
      pending.current = {}; setSending({}); setReady(true);
    };
    const unsubscribe = subscribeSocketTopics(socketSubscribe, [`session:${sessionKey}`, "global"], raw => {
      const msg = raw as ServerMessage;
      if (msg.type === "socket_disconnected") { setReady(false); return; }
      if (msg.type === "socket_reconnected") {
        setReady(false); setError(null); socketSend({ type: "get_tool_approvals", sessionKey }); return;
      }
      if (!("sessionKey" in msg) || msg.sessionKey !== sessionKey) return;
      if (msg.type === "tool_approval_snapshot") update(msg.requests);
      if (msg.type === "sync_response") update(msg.found ? msg.toolApprovals ?? [] : []);
      if (msg.type === "control_response" && msg.command === "respond_tool_approval"
        && Object.values(pending.current).includes(msg.requestId ?? "")) {
        if (!msg.success) setError(msg.error ?? "Unable to send this decision.");
        socketSend({ type: "get_tool_approvals", sessionKey });
      }
    });
    socketSend({ type: "get_tool_approvals", sessionKey });
    return unsubscribe;
  }, [sessionKey, socketSend, socketSubscribe]);
  useEffect(() => {
    if (!requests.length) return;
    const delay = Math.max(0, Math.min(...requests.map(item => item.expiresAt)) - Date.now());
    const timer = setTimeout(() => setRequests(items => items.filter(item => item.expiresAt > Date.now())), delay + 1);
    return () => clearTimeout(timer);
  }, [requests]);
  function decide(item: ToolApprovalRequest, decision: ToolApprovalDecision) {
    if (!ready || !socketSend || pending.current[item.id] || item.expiresAt <= Date.now()) return;
    const requestId = randomUuid();
    pending.current = { ...pending.current, [item.id]: requestId };
    setSending(pending.current); setError(null);
    try { socketSend({ type: "respond_tool_approval", sessionKey, approvalId: item.id, approvalDecision: decision, requestId }); }
    catch { setReady(false); setError("Decision not confirmed. Refresh before trying again."); }
  }
  if (!requests.length && !error) return null;
  return <section className="tool-approvals nodrag nowheel" aria-label={sessionLabel ? `Tool approvals for ${sessionLabel}` : "Tool approvals"} style={{ overflowWrap: "anywhere" }} onPointerDown={event => event.stopPropagation()}>
    <header><strong>{sessionLabel ? `${sessionLabel} — Permission needed` : "Permission needed"}</strong><span>Allow once · this action only</span></header>
    {sessionLabel && <p>{sessionKey}</p>}
    {!ready && <p role="status">Decisions are disabled until the live connection returns.</p>}
    {error && <p role="alert">{error}</p>}
    {requests.map(item => <article key={item.id} aria-label={`Approve ${item.tool}`}>
      <strong>{item.tool}</strong><p>{item.reason}</p>
      <pre tabIndex={0} aria-label={`${item.tool} action details`}>{item.details}</pre>
      <div className="tool-approvals__actions">
        <button type="button" disabled={!ready || !!sending[item.id]} onClick={() => decide(item, "deny")}>Deny</button>
        <button type="button" className="tool-approvals__allow" disabled={!ready || !!sending[item.id]} onClick={() => decide(item, "allow_once")}>Allow once</button>
        {sending[item.id] && <span role="status">Sending decision…</span>}
      </div>
    </article>)}
    {(error || Object.keys(sending).length > 0) && <button type="button" onClick={refresh}>Refresh approval status</button>}
  </section>;
}
