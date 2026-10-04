import { memo } from "react";
import { chatRoleStyle } from "../chat-bubble-style.ts";
import type { ThinkingConfig } from "../types.ts";

/** Live reasoning is one growing prose block, not a list of message chunks. */
export const ThinkingStream = memo(function ThinkingStream({ text, effort, density = "default" }: {
  text: string;
  effort?: ThinkingConfig["effort"];
  density?: "default" | "compact";
}) {
  const bodyStyle = chatRoleStyle("thinking", { density });
  return (
    <section aria-label="Live thinking" style={{
      width: "100%", minWidth: 0, boxSizing: "border-box", marginBlock: 4,
      paddingInlineStart: chatRoleStyle("assistant", { density }).paddingInlineStart,
      paddingInlineEnd: bodyStyle.paddingInlineEnd,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4,
        color: "var(--thinking-accent)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
        <span>Thinking…</span>
        {effort && <span style={{ color: "var(--text-muted)", fontSize: 10 }}
          title={`Thinking effort: ${effort}`}>{effort}</span>}
      </div>
      <div aria-label="Streaming thinking" style={{ ...bodyStyle, paddingInline: 0, paddingBlock: 0 }}>
        {text}
      </div>
    </section>
  );
});
