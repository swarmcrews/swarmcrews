import type { DisplayMessage } from "../sdk-messages.ts";
import { ChatLink } from "./ChatLink.tsx";

interface HistoryLink { label: string; href: string }

/** Recognize only the reducer's generated history markers, not user prose. */
export function sessionHistoryLink(message: Pick<DisplayMessage, "role" | "content">): HistoryLink | null {
  if (message.role !== "system") return null;
  const match = /^\[(Read (?:earlier )?session history)\]\((\/api\/history\/[a-zA-Z0-9_%.-]+(?:\?before=[1-9]\d*)?)\)$/.exec(message.content.trim());
  return match ? { label: match[1]!, href: match[2]! } : null;
}

/** History access is navigation, not a timestamped agent/system message. */
export function SessionHistoryNavigation({ link }: { link: HistoryLink }) {
  return <nav aria-label="Session history"
    style={{ padding: "4px 0", fontSize: "var(--text-size-caption)" }}>
    <ChatLink destination={link.href}>{link.label}</ChatLink>
  </nav>;
}
