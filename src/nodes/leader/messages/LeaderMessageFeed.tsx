/**
 * LeaderMessageFeed — the scrollable conversation feed for the Leader node.
 * Purely presentational: it renders grouped messages, the streaming
 * preview, the optional debug inspector, and the wait countdown.
 */

import { useId, type RefObject } from "react";
import type { TranscriptBoundary } from "../../../components/SessionTranscript.tsx";
import { IterationBoundary } from "./IterationBoundary.tsx";
import { MessageSquare, Sparkles } from "lucide-react";
import "../leader-body.css";
import { StreamingBubble } from "../../../components/StreamingBubble.tsx";
import { MessageTimestamp } from "../../../components/MessageTimestamp.tsx";
import { chatRoleStyle } from "../../../chat-bubble-style.ts";
import { DebugInspector } from "../../../components/DebugInspector.tsx";
import { WaitCountdown } from "../WaitCountdown.tsx";
import { LeaderToolGroup } from "./ToolItem.tsx";
import { LeaderThinkingGroup } from "./ThinkingGroup.tsx";
import { UserMessageBubble } from "./UserMessageBubble.tsx";
import { SelectableMessageBubble } from "./SelectableMessageBubble.tsx";
import { LeaderWorkingIndicator } from "./LeaderWorkingIndicator.tsx";
import type { LeaderData, MessageContextSelection } from "../types.ts";
import type { LeaderMessageGroup } from "../../leader-message-helpers.ts";

export interface LeaderMessageFeedProps {
  outputRef: RefObject<HTMLDivElement | null>;
  data: LeaderData;
  groupedMessages: (LeaderMessageGroup | TranscriptBoundary)[];
  historyLoading?: boolean;
  onScroll?: () => void;
  messageContextSelection: MessageContextSelection | null;
  onActivateMessageSelection: (messageId: string) => void;
  onMessageSelectionChange: (selection: MessageContextSelection) => void;
  onExitMessageSelection: () => void;
  onAddContentNode?: ((content: string) => void) | undefined;
  debugEnabled: boolean;
  isWorking: boolean;
}

export function LeaderMessageFeed({
  outputRef,
  data,
  groupedMessages,
  historyLoading = false,
  onScroll,
  messageContextSelection,
  onActivateMessageSelection,
  onMessageSelectionChange,
  onExitMessageSelection,
  onAddContentNode,
  debugEnabled,
  isWorking,
}: LeaderMessageFeedProps) {
  const scope = useId();
  const boundaries = groupedMessages.filter((group) => group.kind === "run-boundary");
  return (
    <div
      ref={outputRef}
      onMouseDown={(e) => e.stopPropagation()}
      className="leader-message-feed"
      data-selection-viewport="canvas"
      onScroll={onScroll}
      tabIndex={-1}
      aria-label="Conversation messages"
    >
      {historyLoading && <div role="status">Loading iteration history…</div>}
      {groupedMessages.length === 0 && !historyLoading && !data.streamingText && !isWorking && (
        <div className="leader-conversation-empty">
          <div className="leader-conversation-empty__icon" aria-hidden="true">
            {data.sessionKey ? <MessageSquare size={20} strokeWidth={1.5} /> : <Sparkles size={20} strokeWidth={1.5} />}
          </div>
          <h3>{data.sessionKey ? "Your conversation starts here" : "What would you like to build?"}</h3>
          <p>{data.sessionKey
            ? "Send a message to continue with your Leader."
            : "Describe your goal, add any useful context, and let your Leader take it from there."}</p>
        </div>
      )}
      {groupedMessages.map((group, gi) => {
        if (group.kind === "run-boundary") {
          return <IterationBoundary key={group.id} boundary={group} boundaries={boundaries}
            scope={scope} onNavigate={onScroll} />;
        }
        if (group.kind === "tool-group") {
          return <LeaderToolGroup key={`tg-${gi}`} msgs={group.msgs} />;
        }
        if (group.kind === "thinking-group") {
          return (
            <LeaderThinkingGroup
              key={`thg-${gi}`}
              msgs={group.msgs}
              effort={data.thinkingConfig?.effort}
            />
          );
        }
        const msg = group.msg;

        if (msg.role === "user") {
          return <UserMessageBubble key={msg.id} msg={msg} />;
        }

        if (msg.role === "thinking") {
          return (
            <LeaderThinkingGroup
              key={msg.id}
              msgs={[msg]}
              effort={data.thinkingConfig?.effort}
            />
          );
        }

        if (msg.role === "assistant" || msg.role === "result") {
          return (
            <SelectableMessageBubble
              key={msg.id}
              msg={msg}
              selection={messageContextSelection}
              onActivate={onActivateMessageSelection}
              onSelectionChange={onMessageSelectionChange}
              onExit={onExitMessageSelection}
              onAddContentNode={onAddContentNode}
            />
          );
        }

        // System messages — compact
        return (
          <div key={msg.id} style={chatRoleStyle("system")}>
            <div>{msg.content}</div>
            <div className="leader-message-meta">
              {msg.suffix && (
                <span className="leader-message-meta__suffix">{msg.suffix}</span>
              )}
              <MessageTimestamp timestamp={msg.timestamp} />
            </div>
          </div>
        );
      })}
      {data.streamingText ? (
        <StreamingBubble text={data.streamingText.replace(/<!--task-name:.+?-->\s*/g, "")} role="assistant" />
      ) : null}
      {isWorking && <LeaderWorkingIndicator />}
      {debugEnabled && data.sessionKey && (
        <DebugInspector
          sessionKey={data.sessionKey}
          streamingText={data.streamingText}
          streamingBlockIndex={data.streamingBlockIndex ?? null}
          messages={data.messages}
          label="leader"
        />
      )}
      {data.waitUntil && data.waitUntil > Date.now() && (
        <WaitCountdown waitUntil={data.waitUntil} reason={data.waitReason ?? "Waiting..."} />
      )}
    </div>
  );
}
