// Isolated production presentation surfaces: no project writes, API or sessions.
import { useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { CanvasNodeContent } from "../../src/CanvasNodeContent.tsx";
import { CanvasPresentationContext } from "../../src/canvas/CanvasPresentation.tsx";
import { MarkdownPreview } from "../../src/components/MarkdownPreview.tsx";
import { MarkdownEditor } from "../../src/components/MarkdownEditor.tsx";
import { LeaderMessageFeed } from "../../src/nodes/leader/messages/LeaderMessageFeed.tsx";
import { LEADER_DEFAULT_DATA } from "../../src/nodes/leader/types.ts";
import { DashboardSurface } from "../../src/nodes/render/DashboardSurface.tsx";
import type { NodeRenderProps } from "../../src/types.ts";
import { useChatFollow } from "../../src/use-chat-follow.ts";
import "../../src/index.css";
import "../../src/nodes/leader/leader-node.css";

const count = 60;
const eager = new URLSearchParams(location.search).has("eager");
const content = Array.from({ length: 24 }, (_, i) => `## Section ${i}\n\nA **formatted** paragraph with a list and some code.\n\n- First item\n- Second item\n\n\`\`\`ts\nconst value = ${i};\n\`\`\``).join("\n\n");
const messages = Array.from({ length: 24 }, (_, i) => ({ kind: "single" as const,
  msg: { id: `msg-${i}`, role: "assistant" as const, content: `Response ${i}\n\n${content.slice(0, 700)}`, timestamp: i } }));
const noop = () => {};
let runtimes = 0;
function Surface({ node }: NodeRenderProps) {
  useEffect(() => { runtimes++; return () => { runtimes--; }; }, []);
  const ready = useContext(CanvasPresentationContext);
  const [draft, setDraft] = useState("A retained editor draft");
  const follow = useChatFollow(node.id, messages);
  return <CanvasPresentationContext.Provider value={eager || ready}>
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-secondary)" }}>
      <header>Card {node.id} — {String(node.data)}</header>
      <div style={{ height: 160, display: "flex", overflow: "hidden" }}>
        <div style={{ width: "50%", overflow: "auto" }}><MarkdownPreview content={content} /></div>
        <div style={{ width: "50%" }}><MarkdownEditor value={draft} onChange={setDraft} ariaLabel={`Editor ${node.id}`} /></div>
      </div>
      <div style={{ height: 160, overflow: "hidden" }}><DashboardSurface renderState={{ layout: { columns: 2 },
        components: Array.from({ length: 20 }, (_, i) => ({ id: `metric-${i}`, type: "metric" as const, label: `Metric ${i}`, value: String(i) })) }} /></div>
      <LeaderMessageFeed outputRef={follow.feedRef} contentRef={follow.contentRef} onScroll={follow.onScroll} data={LEADER_DEFAULT_DATA}
        groupedMessages={messages} debugEnabled={false} isWorking={false} messageContextSelection={null}
        onActivateMessageSelection={noop} onMessageSelectionChange={noop} onExitMessageSelection={noop} />
    </div>
  </CanvasPresentationContext.Provider>;
}
function Fixture() {
  const [pan, setPan] = useState(0);
  const [revision, setRevision] = useState("Initial data");
  const [parked, setParked] = useState(true);
  return <>
    <nav style={{ position: "fixed", zIndex: 100, right: 10, top: 10 }}>
      <button onClick={() => setPan(-450)}>Warm card 1</button>
      <button onClick={() => setPan(-2000)}>Pan to card 1</button>
      <button onClick={() => setPan(0)}>Pan to card 0</button>
      <button onClick={() => setRevision("Updated while offscreen")}>Update data</button>
      <button onClick={() => { setParked(false); setPan(-118000); }}>Open parked card</button>
    </nav>
    <main className="canvas-root" style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <div style={{ transform: `translateX(${pan}px)` }}>
        {Array.from({ length: count }, (_, i) => <div key={i} className="canvas-node-card"
          data-canvas-node-id={i} data-parked={i === count - 1 && parked || undefined}
          style={{ position: "absolute", left: 20 + i * 2000, top: 40, width: 560, height: 600,
            display: i === count - 1 && parked ? "none" : undefined }}>
          <CanvasNodeContent renderer={Surface} hiddenForDrag={false} isSelected={false} onUpdateData={noop}
            node={{ id: String(i), type: "fixture", data: revision, position: { x: i * 2000, y: 0 }, size: { width: 560, height: 600 } }} />
        </div>)}
      </div>
    </main>
  </>;
}
const start = performance.now();
flushSync(() => createRoot(document.getElementById("root")!).render(<Fixture />));
Object.assign(window, { canvasStartupMetrics: { mountMs: performance.now() - start }, canvasRuntimeCount: () => runtimes });
