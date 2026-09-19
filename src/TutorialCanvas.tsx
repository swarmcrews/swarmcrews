import { useEffect, useRef, useState, type ReactNode } from "react";
import { PortDot, type PortInfo } from "./components/PortDot.tsx";
import { CanvasContextMenu } from "./components/CanvasContextMenu.tsx";
import { EdgeRenderer } from "./EdgeRenderer.tsx";
import { createEdge } from "./graph-runtime.ts";
import { LEADER_CONTRACT, type GraphDocument } from "./graph.ts";
import { CONTEXT_MODE_MENU_OPTIONS, resolveContextMode } from "./leader-context-mode.ts";
import { LeaderPromptBar } from "./nodes/leader/prompt/LeaderPromptBar.tsx";
import { LeaderBody } from "./nodes/leader/LeaderBody.tsx";
import { LeaderStatusIcon } from "./nodes/leader/LeaderStatusIcon.tsx";
import { GraphPlanProposalCard, GraphPlanProposalDialog } from "./task-graph/GraphPlanProposal.tsx";
import type { TaskGraphPlanSnapshotView } from "../shared/task-graph-planning-contracts.ts";
import type { RenderState } from "../shared/render-dsl.ts";
import type { CanvasNode } from "./types.ts";
import "./nodes/leader/leader-node.css";
import "./tutorial-canvas.css";

const source: CanvasNode = { id: "tutorial-design", type: "leader", position: { x: 40, y: 40 }, size: { width: 360, height: 430 }, data: {} };
const target: CanvasNode = { id: "tutorial-build", type: "leader", position: { x: 530, y: 40 }, size: { width: 400, height: 430 }, data: {} };
const output: PortInfo = { nodeId: source.id, nodeType: "leader", portId: "context-out", direction: "output", protocol: "context" };
const empty: RenderState = { layout: {}, components: [] };
const design: RenderState = { layout: { title: "Welcome page brief" }, components: [
  { id: "brief", type: "text", content: "Build a welcoming home page with a clear heading and one Get started button. Keep it accessible and easy to use." },
  { id: "ready", type: "status", label: "Design brief ready", state: "success" },
] };
const plan: TaskGraphPlanSnapshotView = {
  proposalId: "tutorial-plan", workItemId: "tutorial-work", primaryRunKey: "tutorial-run",
  revision: 1, proposalRevision: 1, baseProposalRevision: null, state: "ready", mode: "plan",
  objective: "Build and verify an accessible welcome page", acceptanceCriteria: ["Welcome heading and Get started button are present", "Accessibility checks pass"],
  assumptions: [], questions: [], workPacketId: null,
  steps: [
    { key: "build", nodeId: "build", title: "Build the welcome page", objective: "Implement the connected design brief", acceptanceCriteria: ["Heading and button match the brief"], dependsOn: [], contextSelectors: [], inputBindings: {}, outputSchemas: {}, outputExamples: {}, executorClass: "standard", risk: "low", requiresApproval: false },
    { key: "verify", nodeId: "verify", title: "Verify accessibility", objective: "Check the completed page", acceptanceCriteria: ["Heading and button have accessible names"], dependsOn: ["build"], contextSelectors: [], inputBindings: {}, outputSchemas: {}, outputExamples: {}, executorClass: "standard", risk: "low", requiresApproval: false },
  ],
  materializedRevisionId: "tutorial-revision", graphRunId: null, sourceSnapshotId: null,
  autoStartEligible: false, canStart: true, reviewRequirements: [], topologyWarnings: [], error: null, updatedAt: 1,
};

function LeaderFrame({ node, title, children, ports }: { node: CanvasNode; title: string; children: ReactNode; ports?: ReactNode }) {
  return <section className="tutorial-canvas-node" aria-label={title} style={{ left: node.position.x, top: node.position.y, width: node.size.width, height: node.size.height }}>
    <div className="leader-node" data-status="idle">
      <header className="leader-node__header">
        <div className="leader-node__identity">
          <div className="leader-node__avatar" aria-hidden="true"><LeaderStatusIcon active={false} size={20} decorative /><span className="leader-node__presence" /></div>
          <div className="leader-node__heading"><div className="leader-node__title">{title}</div><div className="leader-node__meta"><span className="leader-node__status">idle</span></div></div>
        </div>
      </header>
      {children}
    </div>
    {ports}
  </section>;
}

/** Real canvas presentation components with local, deterministic agent responses. */
export function TutorialCanvas({ step, onComplete }: { step: number; onComplete: () => void }) {
  const worldRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const buildRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [brief, setBrief] = useState("");
  const [sentBrief, setSentBrief] = useState("");
  const [request, setRequest] = useState("");
  const [sentRequest, setSentRequest] = useState("");
  const [feedback, setFeedback] = useState("");
  const [sourceView, setSourceView] = useState<"chat" | "dashboard" | "minions">("chat");
  const [targetExists, setTargetExists] = useState(false);
  const [graph, setGraph] = useState<GraphDocument>({ edges: [] });
  const [drag, setDrag] = useState<{ x: number; y: number; snap: boolean } | null>(null);
  const dragging = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "share" | "add" } | null>(null);
  const [details, setDetails] = useState(false);
  const [planSnapshot, setPlanSnapshot] = useState(plan);
  const [focusRequest, setFocusRequest] = useState(0);
  const [started, setStarted] = useState(false);
  const connected = graph.edges.length > 0;
  const activeDrag = drag !== null;

  useEffect(() => {
    if (step === 1) setSourceView("dashboard");
    if (step >= 2) scrollRef.current?.scrollTo?.({ left: 490 });
  }, [step]);

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); setMenu(null);
        worldRef.current?.querySelector<HTMLElement>('[data-port-id="context-out"]')?.focus();
      }
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [menu]);

  useEffect(() => {
    if (focusRequest) buildRef.current?.focus();
  }, [focusRequest]);

  const connect = (mode = "dashboard") => {
    const edge = createEdge(source.id, "context-out", "leader", target.id, "context-in", "leader", {});
    if (!edge) return;
    setTargetExists(true);
    setGraph({ edges: [{ ...edge, contextMode: resolveContextMode(mode) }] });
    setMenu(null);
    setDrag(null);
    dragging.current = false;
    onComplete();
  };

  const point = (clientX: number, clientY: number) => {
    const bounds = worldRef.current!.getBoundingClientRect();
    const x = clientX - bounds.left, y = clientY - bounds.top;
    const snap = targetExists && Math.hypot(x - target.position.x, y - (target.position.y + target.size.height * .95)) < 30;
    return { x, y, snap };
  };
  const beginDrag = (clientX: number, clientY: number) => {
    if (step !== 1 || connected) return;
    setMenu(null);
    dragging.current = true;
    setDrag(point(clientX, clientY));
  };
  const drop = (clientX: number, clientY: number) => {
    if (!dragging.current) return;
    dragging.current = false;
    const p = point(clientX, clientY);
    setDrag(null);
    if (p.snap) { connect(); return; }
    // Ignore drops off the practice canvas or over a node body.
    const overNode = [source, ...(targetExists ? [target] : [])].some(n => p.x >= n.position.x && p.x <= n.position.x + n.size.width && p.y >= n.position.y && p.y <= n.position.y + n.size.height);
    if (p.x < 0 || p.x > 980 || p.y < 0 || p.y > 520 || overNode) return;
    setMenu({ x: clientX, y: clientY, kind: "share" });
  };

  useEffect(() => {
    if (!activeDrag) return;
    const move = (event: MouseEvent | PointerEvent) => {
      if (!dragging.current) return;
      const viewport = scrollRef.current;
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        if (event.clientX > rect.right - 40) viewport.scrollLeft += 16;
        if (event.clientX < rect.left + 40) viewport.scrollLeft -= 16;
      }
      setDrag(point(event.clientX, event.clientY));
    };
    const up = (event: MouseEvent | PointerEvent) => drop(event.clientX, event.clientY);
    const cancel = () => { dragging.current = false; setDrag(null); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  });

  const sendBrief = () => {
    if (step !== 0 || !brief.trim() || sentBrief) return;
    setSentBrief(brief.trim()); setBrief(""); onComplete();
  };
  const sendRequest = () => {
    if (step < 2 || !connected || !request.trim() || started) return;
    if (!sentRequest && !/\b(graph|crew)\b/i.test(request)) {
      setFeedback("For this objective, ask the leader to build a task graph. Try: Build a task graph to implement the welcome page and verify accessibility.");
      return;
    }
    if (sentRequest) {
      setPlanSnapshot(previous => ({ ...previous, proposalRevision: previous.proposalRevision + 1,
        revision: previous.revision + 1, acceptanceCriteria: [...previous.acceptanceCriteria, request.trim()] }));
    }
    setSentRequest(request.trim()); setRequest(""); setFeedback("");
    if (step === 2) onComplete();
  };
  const start = () => {
    setStarted(true); setDetails(false); onComplete();
  };
  const actions = {
    controlsEnabled: step === 3 && !started, stale: false, onStart: start,
    onAdjust: () => { setDetails(false); setFeedback("Tell the leader what you want to change in its prompt below."); setFocusRequest(value => value + 1); },
    onReject: () => { setDetails(false); setSentRequest(""); setFeedback("Plan dismissed. Ask the leader for a new task graph."); },
    onOpen: () => setDetails(true),
  };
  const keyboardPort = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const port = (event.target as HTMLElement).closest<HTMLElement>("[data-port-id]");
    if (!port || step !== 1 || connected) return;
    event.preventDefault();
    if (port.dataset["portId"] === "context-out") {
      const bounds = port.getBoundingClientRect(); beginDrag(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    } else if (dragging.current) connect();
  };

  return <>
    <div className="tutorial-canvas-label"><span>Canvas · Practice project</span><span>Simulated leader responses</span></div>
    <div ref={scrollRef} className="tutorial-canvas-scroll">
      <div ref={worldRef} className="tutorial-canvas-world" aria-label="Practice canvas" data-tutorial-step={step}
        onKeyDownCapture={keyboardPort}
        onPointerDownCapture={event => {
          if (event.pointerType === "mouse") return;
          const port = (event.target as HTMLElement).closest<HTMLElement>('[data-port-id="context-out"]');
          if (port) { event.preventDefault(); beginDrag(event.clientX, event.clientY); }
        }}
        onContextMenu={event => {
          if (step !== 1 || connected || (event.target as HTMLElement).closest(".tutorial-canvas-node")) return;
          event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, kind: "add" });
        }}>
        <EdgeRenderer graph={graph} nodes={[source, target]} />
        {drag && <svg className="tutorial-drag-edge" aria-label="Connection preview"><path d={`M400 255 C460 255, ${drag.snap ? 470 : drag.x - 60} ${drag.snap ? 448.5 : drag.y}, ${drag.snap ? 530 : drag.x} ${drag.snap ? 448.5 : drag.y}`} /></svg>}
        <LeaderFrame node={source} title="Design the welcome page" ports={
          <PortDot {...output} label="Share context" topPx={source.size.height * LEADER_CONTRACT.ports.find(p => p.id === "context-out")!.anchorY!}
            onConnectionStart={(_, event) => beginDrag(event.clientX, event.clientY)} isDragActive={activeDrag} />
        }>
          <LeaderBody renderState={sentBrief ? design : empty} activeBodyView={sourceView} onActiveBodyViewChange={setSourceView}
            chat={<><div className="tutorial-chat-log">{sentBrief ? <><p className="tutorial-user-message">{sentBrief}</p><p>I’ve prepared the welcome page brief in the Dashboard. Share it with a new leader to build the page.</p></> : <p>Describe the outcome you want. Try: “Create a design brief for a welcoming home page with a Get started button.”</p>}</div>
              <LeaderPromptBar input={brief} onInputChange={setBrief} onSubmit={sendBrief} placeholder="Tell the leader what to do…" submitLabel="Start" disabled={!brief.trim() || !!sentBrief || step !== 0} active={!!brief.trim()}
                onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendBrief(); } }} /></>} />
        </LeaderFrame>
        {targetExists ? <LeaderFrame node={target} title="Build the welcome page" ports={
          <PortDot nodeId={target.id} nodeType="leader" portId="context-in" direction="input" protocol="context" label="Context" topPx={target.size.height * .95}
            locked={!!sentRequest} isDragActive={activeDrag} isValidTarget={activeDrag && !connected} isSnapTarget={!!drag?.snap}
            onConnectionEnd={() => { if (dragging.current && !connected) connect(); }} />
        }>
          {sentRequest && !started && <div className="tg-graph-row"><GraphPlanProposalCard snapshot={planSnapshot} actions={actions} /></div>}
          <div className="tutorial-build-body">
            <div className="tutorial-chat-log">
              {connected && <p className="tutorial-context-receipt">Connected context: {CONTEXT_MODE_MENU_OPTIONS.find(o => o.type === graph.edges[0]?.contextMode)?.label} from Design the welcome page</p>}
              {sentRequest && <p className="tutorial-user-message">{sentRequest}</p>}
              {sentRequest && !started && <p>I’ve built the task graph. Review the plan, then start it when you’re ready.</p>}
              {started && <p role="status">Practice run complete. The leader built the page and verified accessibility. In your project, inspect the leader’s results and verification evidence before accepting the work.</p>}
              {feedback && <p role="status">{feedback}</p>}
            </div>
            <LeaderPromptBar input={request} onInputChange={setRequest} onSubmit={sendRequest} placeholder="Tell the leader what to do…" submitLabel={sentRequest ? "Send" : "Start"} disabled={step < 2 || !request.trim() || started} active={!!request.trim()} textareaRef={buildRef}
              onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendRequest(); } }} />
          </div>
        </LeaderFrame> : step === 1 && <div className="tutorial-canvas-drop" role="group" aria-label="Empty canvas drop area" tabIndex={0}
          onKeyDown={event => { if (dragging.current && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); dragging.current = false; setDrag(null); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left + 30, y: rect.top + 60, kind: "share" }); } }}>
          <strong>Drag the leader’s output chevron here</strong><span>Release on empty canvas, then choose Dashboard.</span><small>Or right-click here to add a Leader, then drag to its Context input.</small>
        </div>}
      </div>
    </div>
    {menu && <div ref={menuRef} onKeyDownCapture={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMenu(null); } }}>
      <CanvasContextMenu x={menu.x} y={menu.y} title={menu.kind === "share" ? "Use dashboard context" : "Add node"}
        options={menu.kind === "share" ? [...CONTEXT_MODE_MENU_OPTIONS] : [{ label: "Leader", type: "leader" }]}
        onSelect={mode => { if (menu.kind === "share") connect(mode); else { setTargetExists(true); setMenu(null); } }} onClose={() => setMenu(null)} />
    </div>}
    {details && <GraphPlanProposalDialog snapshot={planSnapshot} actions={actions} onClose={() => setDetails(false)} />}
  </>;
}
