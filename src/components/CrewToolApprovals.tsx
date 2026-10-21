import { useEffect, useState } from "react";
import { approvalChildrenSchema, type ApprovalChild } from "../../shared/session-crew.ts";
import { subscribeSocketTopics, type ServerMessage } from "../use-socket.ts";
import { ToolApprovalPanel, type ToolApprovalPanelProps } from "./ToolApprovalPanel.tsx";

export interface CrewApprovalMember {
  sessionKey: string | null;
  title: string;
}

type Props = ToolApprovalPanelProps & {
  members: readonly CrewApprovalMember[];
  approvalChildren?: readonly ApprovalChild[] | undefined;
};

/** Legacy/direct rosters remain unchanged. Canonical membership comes only from
 * server snapshots; lifecycle signals invalidate/refetch, never add child keys. */
export function CrewToolApprovals(props: Props) {
  return <ApprovalCrew key={props.sessionKey} {...props} />;
}
function ApprovalCrew({ sessionKey, members, approvalChildren, ...socket }: Props) {
  const [canonical, setCanonical] = useState<readonly ApprovalChild[]>(approvalChildren ?? []);
  useEffect(() => {
    if (approvalChildren) setCanonical(approvalChildren);
  }, [approvalChildren]);
  useEffect(() => {
    if (!sessionKey || sessionKey.startsWith("work-item:") || !socket.socketSend || !socket.socketSubscribe) return;
    const refresh = () => socket.socketSend?.({ type: "sync_session", sessionKey });
    const unsubscribe = subscribeSocketTopics(socket.socketSubscribe, [`session:${sessionKey}`, "global"], raw => {
      const msg = raw as ServerMessage;
      if (msg.type === "socket_disconnected") { setCanonical([]); return; }
      if (msg.type === "socket_reconnected") { refresh(); return; }
      if (!("sessionKey" in msg) || msg.sessionKey !== sessionKey) return;
      if (msg.type === "session_crew_invalidated") {
        // Retire stale attempts immediately, even while the sync reply is in flight.
        setCanonical([]); refresh();
      }
      if (msg.type === "sync_response") {
        const parsed = approvalChildrenSchema.safeParse(msg.found ? msg.approvalChildren ?? [] : []);
        setCanonical(parsed.success ? parsed.data : []);
      }
    });
    refresh();
    return unsubscribe;
  }, [sessionKey, socket.socketSend, socket.socketSubscribe]);
  const seen = new Set<string>();
  const sessions: { sessionKey: string; sessionLabel?: string }[] = [];
  const add = (key: string | null, label?: string) => {
    if (!key || key.startsWith("work-item:") || seen.has(key)) return;
    seen.add(key);
    sessions.push({ sessionKey: key, ...(label ? { sessionLabel: label } : {}) });
  };
  add(sessionKey);
  for (const member of canonical) add(member.sessionKey, member.title || member.taskId);
  for (const member of members) add(member.sessionKey, member.title || member.sessionKey || "Minion");
  return <div style={{ minHeight: 0, maxHeight: "min(440px, 55vh)", overflow: "auto", flexShrink: 0 }}>
    {sessions.map(session => <ToolApprovalPanel key={session.sessionKey} {...socket} {...session} />)}
  </div>;
}
