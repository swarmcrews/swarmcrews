import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, ArrowRight, Check, Crosshair, MousePointer2, Scan, Hand, ShieldCheck, MessageSquarePlus, ChevronDown, Pencil, X } from "lucide-react";
import type { HtmlArtifactComponent } from "../../../shared/render-dsl.ts";
import { randomUuid } from "../../random-id.ts";
import { captureTarget, downloadFeedback, feedbackMarkdown, feedbackPayload, hasFeedbackContent, locateTarget, reviewDocument, type FeedbackItem, type FeedbackTarget } from "./html-feedback.ts";
import { hitFeedbackRegion } from "./html-feedback-regions.ts";
import { useHtmlFeedbackPreviews } from "./use-html-feedback-previews.ts";
import { startInlineTextEdit } from "./inline-text-edit.ts";
import { HtmlFeedbackNotes, isDraftNote, noteLabel } from "./HtmlFeedbackNotes.tsx";
import type { useHtmlFeedback } from "./use-html-feedback.ts";
import "./html-feedback.css";

type Feedback = ReturnType<typeof useHtmlFeedback>;
export function HtmlFeedbackReview({ c, feedback, closeGuard, onClose }: {
  c: HtmlArtifactComponent; feedback: Feedback; closeGuard?: RefObject<(() => void) | null>; onClose?: () => void;
}) {
  const { state, setState, pending } = feedback;
  const frame = useRef<HTMLIFrameElement>(null);
  const canvasScroll = useRef<HTMLDivElement>(null);
  const undo = useRef<(() => void) | null>(null);
  const element = useRef<Element | null>(null);
  const inlineSession = useRef<ReturnType<typeof startInlineTextEdit> | null>(null);
  const [inlineEditing, setInlineEditing] = useState(false);
  const inlineElement = useRef<Element | null>(null);
  const [attachId, setAttachId] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const selectButton = useRef<HTMLButtonElement>(null);
  const previousPhase = useRef<"annotate" | "review">("annotate");
  const [phase, setPhase] = useState<"annotate" | "review">("annotate");
  const [sheetOpen, setSheetOpen] = useState(true);
  const [drag, setDrag] = useState<FeedbackTarget["bounds"] | null>(null);
  const suppressRegionClick = useRef(false);
  const [loaded, setLoaded] = useState(0);
  const [mode, setMode] = useState<"element" | "region" | "browse">("element");
  const [width, setWidth] = useState(() => window.innerWidth <= 800 ? 360 : 768);
  const height = 560;
  const [target, setTarget] = useState<FeedbackTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspection, setInspection] = useState(0);
  const [request, setRequest] = useState("");
  const [preview, setPreview] = useState<{ before: string; after: string } | undefined>();
  const [hover, setHover] = useState<FeedbackTarget["bounds"] | null>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [choices, setChoices] = useState<Element[]>([]);
  const [notice, setNotice] = useState("");
  const srcDoc = useMemo(() => reviewDocument(c.html), [c.html]);
  const selectedNote = state.items.find(i => i.id === selectedId);
  const effectiveRequest = request.trim() ? request : preview ? "Replace the selected text as previewed." : request;
  const dirty = selectedNote
    ? effectiveRequest !== selectedNote.request || JSON.stringify(preview) !== JSON.stringify(selectedNote.preview)
    : !!(request.trim() || preview);
  const readOnly = pending || (!!selectedNote && !isDraftNote(selectedNote));
  const previews = useHtmlFeedbackPreviews(frame.current?.contentDocument, state, c.html, width, inlineEditing);
  const inlineBaseline = useRef<typeof preview>(undefined);

  function restorePreview() { inlineSession.current?.restore(); inlineSession.current = null; inlineElement.current = null; setInlineEditing(false); undo.current?.(); undo.current = null; }
  function clearPreview() { restorePreview(); setPreview(undefined); }
  function finishInline() {
    if (!inlineSession.current) return;
    inlineSession.current.stop();
    if (preview || selectedNote?.preview) persist();
    else restorePreview();
  }
  function cancelInline() { restorePreview(); setPreview(inlineBaseline.current); input.current?.focus(); }
  const finishInlineRef = useRef(finishInline); finishInlineRef.current = finishInline;
  const cancelInlineRef = useRef(cancelInline); cancelInlineRef.current = cancelInline;
  function undoPreview() {
    clearPreview();
    if (selectedNote) setState(s => ({ ...s, items: s.items.flatMap(i => i.id !== selectedNote.id ? [i]
      : i.request === "Replace the selected text as previewed." ? [] : [{ ...i, preview: undefined }]) }));
  }
  function editText() {
    const el = element.current as HTMLElement | null;
    if (!el || readOnly || el.namespaceURI !== "http://www.w3.org/1999/xhtml") return;
    const initial = preview?.after ?? el.textContent ?? "";
    restorePreview(); inlineBaseline.current = preview;
    const before = preview?.before ?? el.textContent ?? "";
    const session = startInlineTextEdit(el, initial, after => setPreview(after === before ? undefined : { before, after }),
      () => finishInlineRef.current(), () => cancelInlineRef.current());
    inlineSession.current = session; undo.current = session.restore; inlineElement.current = el;
    setInlineEditing(true); setHover(null); setNotice("");
  }
  function resetEditor() {
    clearPreview(); setSelectedId(null); setTarget(null); setHover(null); element.current = null;
    setRequest(""); setNotice("");
  }
  function canLeaveEditor() { return !dirty || persist(); }
  function discardCurrent() {
    if (readOnly) return;
    clearPreview();
    if (selectedNote) setState(s => ({ ...s, items: s.items.filter(i => i.id !== selectedNote.id) }));
    setSelectedId(null); setRequest(""); setNotice("Changes discarded. This object is back to its original state.");
  }
  function beginTarget(next: FeedbackTarget, el: Element | null) {
    if (pending || !canLeaveEditor()) return;
    setPhase("annotate"); setSheetOpen(true);
    resetEditor();
    element.current = el; setTarget(next); setHover(null);
    setNotice("");
  }
  function select(el: Element) {
    const note = [...state.items].reverse().find(i => i.id === previews.noteId(el) ||
      (state.captures.some(capture => capture.id === i.captureId && capture.html === c.html) && locateTarget(el.ownerDocument, i.target) === el));
    if (note) inspect(note); else beginTarget(previews.capture(el, width, height), el);
  }
  const selectRef = useRef(select); selectRef.current = select;
  function regionAt(x: number, y: number) {
    const win = frame.current?.contentWindow;
    return hitFeedbackRegion(state, c.html, width, height, { x, y }, { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 });
  }
  const regionAtRef = useRef(regionAt); regionAtRef.current = regionAt;
  const inspectRef = useRef(inspect); inspectRef.current = inspect;
  function drawRegion(next: FeedbackTarget) {
    if (pending || !canLeaveEditor()) return;
    if (state.items.length >= 100) { setNotice("This review has 100 notes. Discard a note before drawing another region."); return; }
    let id = "";
    setState(s => {
      if (s.items.length >= 100) return s;
      id = `F${String(Math.max(0, ...s.items.map(i => Number.parseInt(i.id.slice(1), 10) || 0)) + 1).padStart(2, "0")}-${randomUuid().slice(0, 8)}`;
      const existing = s.captures.find(capture => capture.html === c.html && capture.width === width && capture.height === height);
      const capture = existing ?? { id: randomUuid(), html: c.html, width, height, capturedAt: new Date().toISOString() };
      return { captures: existing ? s.captures : [...s.captures, capture], items: [...s.items, {
        id, captureId: capture.id, target: next, request: "", acceptance: "", scope: "instance", status: "ready",
      }] };
    });
    if (!id) return;
    resetEditor(); setTarget(next); setSelectedId(id); setMode("element"); setPhase("annotate"); setSheetOpen(true);
    suppressRegionClick.current = true;
  }
  const drawRegionRef = useRef(drawRegion); drawRegionRef.current = drawRegion;

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    const win = frame.current?.contentWindow;
    if (!doc || !win) return;
    const body = doc.body;
    const original = { cursor: body.style.cursor, touchAction: body.style.touchAction, userSelect: body.style.userSelect };
    body.style.cursor = mode === "region" ? "crosshair" : mode === "element" ? "crosshair" : "auto";
    body.style.touchAction = mode === "region" ? "none" : "auto";
    body.style.userSelect = mode === "browse" ? "auto" : "none";
    let start: { x: number; y: number } | null = null;
    const block = (e: Event) => e.preventDefault();
    const move = (e: MouseEvent) => {
      if (inlineElement.current || mode !== "element" || (e.target as Node | null)?.nodeType !== 1) return;
      const region = regionAtRef.current(e.clientX, e.clientY)?.target;
      setHover(region ? { ...region.bounds, x: region.bounds.x + (region.scroll.x - win.scrollX) / width,
        y: region.bounds.y + (region.scroll.y - win.scrollY) / height } : captureTarget(e.target as Element, width, height).bounds);
    };
    const leave = () => { setHover(null); setDrag(null); start = null; };
    const pointerMove = (e: PointerEvent) => {
      if (start) setDrag({ x: Math.min(start.x, e.clientX) / width, y: Math.min(start.y, e.clientY) / height, width: Math.abs(e.clientX - start.x) / width, height: Math.abs(e.clientY - start.y) / height });
    };
    const click = (e: MouseEvent) => {
      if (inlineElement.current?.contains(e.target as Node)) return;
      e.preventDefault();
      if (suppressRegionClick.current) { suppressRegionClick.current = false; return; }
      if (mode === "element" && (e.target as Node | null)?.nodeType === 1) {
        const region = regionAtRef.current(e.clientX, e.clientY);
        if (region) inspectRef.current(region); else selectRef.current(e.target as Element);
      }
    };
    const down = (e: PointerEvent) => {
      suppressRegionClick.current = false;
      if (inlineElement.current || mode !== "region") return;
      e.preventDefault(); start = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (!start) return;
      const a = start; start = null; setDrag(null);
      if (Math.abs(e.clientX - a.x) < 3 || Math.abs(e.clientY - a.y) < 3) return;
      drawRegionRef.current({ kind: "region", bounds: { x: Math.min(a.x, e.clientX) / width, y: Math.min(a.y, e.clientY) / height,
        width: Math.abs(a.x - e.clientX) / width, height: Math.abs(a.y - e.clientY) / height }, scroll: { x: win.scrollX, y: win.scrollY } });
    };
    const onScroll = () => { setHover(null); setDrag(null); start = null; setScroll({ x: win.scrollX, y: win.scrollY }); };
    doc.addEventListener("click", click, true); doc.addEventListener("submit", block, true);
    doc.addEventListener("mousemove", move); doc.addEventListener("mouseleave", leave);
    doc.addEventListener("pointermove", pointerMove); doc.addEventListener("pointerdown", down); doc.addEventListener("pointerup", up); doc.addEventListener("pointercancel", leave);
    win.addEventListener("scroll", onScroll);
    setChoices(Array.from(doc.body?.querySelectorAll("h1,h2,h3,h4,p,li,section,article,div,span,td,th,img,svg,a,button,label,input") ?? []).filter(el => el.getBoundingClientRect().height > 0).slice(0, 300));
    return () => {
      Object.assign(body.style, original);
      doc.removeEventListener("click", click, true); doc.removeEventListener("submit", block, true);
      doc.removeEventListener("mousemove", move); doc.removeEventListener("mouseleave", leave);
      doc.removeEventListener("pointermove", pointerMove); doc.removeEventListener("pointerdown", down); doc.removeEventListener("pointerup", up); doc.removeEventListener("pointercancel", leave);
      win.removeEventListener("scroll", onScroll);
    };
  }, [loaded, mode, width]);
  useEffect(() => () => undo.current?.(), []);
  useEffect(() => { restorePreview(); setTarget(null); setHover(null); element.current = null; }, [c.html, width]);
  useEffect(() => {
    if (!selectedNote) return;
    const capture = state.captures.find(capture => capture.id === selectedNote.captureId);
    const doc = frame.current?.contentDocument;
    if (!doc || capture?.html !== c.html || capture.width !== width) return;
    const el = previews.element(selectedNote.id) ?? locateTarget(doc, selectedNote.target);
    // Regions are tied to the exact capture; element identity is never guessed.
    if (selectedNote.target.kind === "element" && !el) return;
    element.current = el; setTarget(selectedNote.target);
    doc.documentElement.scrollTop = selectedNote.target.scroll.y;
    doc.documentElement.scrollLeft = selectedNote.target.scroll.x;
    setScroll(selectedNote.target.scroll);
  }, [selectedId, selectedNote?.captureId, inspection, loaded, c.html, width]);
  useEffect(() => { if (selectedId && !selectedNote) resetEditor(); }, [selectedId, selectedNote]);
  useEffect(() => {
    const viewport = canvasScroll.current;
    if (!viewport || !target) return;
    // Opening the mobile sheet shrinks the preview. Keep the target's edit label
    // in view without moving the captured evidence or scrolling the inspector.
    const win = frame.current?.contentWindow;
    viewport.scrollTop = Math.max(0, target.bounds.y * height + target.scroll.y - (win?.scrollY ?? 0) - 6);
    viewport.scrollLeft = Math.max(0, target.bounds.x * width + target.scroll.x - (win?.scrollX ?? 0) - 8);
  }, [target, width, sheetOpen, inlineEditing]);

  useEffect(() => {
    if (sheetOpen && (target || selectedId)) {
      input.current?.focus({ preventScroll: true });
      input.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [target, selectedId, sheetOpen]);
  useEffect(() => {
    if (phase === "review") reviewHeading.current?.focus();
    else if (previousPhase.current === "review") selectButton.current?.focus();
    previousPhase.current = phase;
  }, [phase]);
  useEffect(() => {
    if (closeGuard) closeGuard.current = () => { if (canLeaveEditor()) onClose?.(); };
    return () => { if (closeGuard) closeGuard.current = null; };
  }, [closeGuard, canLeaveEditor, onClose]);
  useEffect(() => {
    if (!dirty && !feedback.storageError) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, feedback.storageError]);

  function inspect(item: FeedbackItem) {
    if (!canLeaveEditor()) return;
    setPhase("annotate"); setSheetOpen(true);
    clearPreview(); setSelectedId(item.id); setInspection(n => n + 1); setTarget(null); element.current = null; setHover(null);
    setRequest(item.request); setPreview(item.preview);
    const capture = state.captures.find(capture => capture.id === item.captureId);
    if (capture?.html === c.html) setWidth(capture.width);
    setNotice(isDraftNote(item) ? "" : "Submitted notes are read-only. Reopen from review to revise.");

  }
  function persist(nextRequest = request): boolean {
    if (readOnly || (!selectedNote && !target)) return false;
    if (!nextRequest.trim() && !preview && selectedNote?.target.kind !== "region") {
      if (selectedNote) setState(s => ({ ...s, items: s.items.filter(i => i.id !== selectedNote.id) }));
      restorePreview(); setSelectedId(null); setRequest(nextRequest);
      return true;
    }
    if (!selectedNote && state.items.length >= 100) {
      setNotice("This review has 100 notes. Discard a note or export before adding another."); return false;
    }
    const wording = nextRequest.trim() || !preview ? nextRequest : "Replace the selected text as previewed.";
    restorePreview();
    if (selectedNote) {
      setState(s => ({ ...s, items: s.items.map(i => i.id === selectedNote.id ? { ...i, request: wording, preview } : i) }));
      setRequest(nextRequest); setNotice("");
      return true;
    }
    let savedId = "";
    setState(s => {
      const existing = s.captures.find(capture => capture.html === c.html && capture.width === width && capture.height === height);
      const capture = existing ?? { id: randomUuid(), html: c.html, width, height, capturedAt: new Date().toISOString() };
      const nextNumber = Math.max(0, ...s.items.map(i => Number.parseInt(i.id.slice(1), 10) || 0)) + 1;
      const id = `F${String(nextNumber).padStart(2, "0")}-${randomUuid().slice(0, 8)}`;
      savedId = id;
      return { captures: existing ? s.captures : [...s.captures, capture], items: [...s.items, {
        id, captureId: capture.id, target: target!, request: wording, acceptance: "", scope: "instance", status: "ready", ...(preview ? { preview } : {}),
      }] };
    });
    if (savedId) { setSelectedId(savedId); setRequest(nextRequest); }
    return !!savedId;
  }
  function remove(item: FeedbackItem) {
    if (pending || !isDraftNote(item)) return;
    setState(s => ({ ...s, items: s.items.filter(i => i.id !== item.id) }));
    if (selectedId === item.id) resetEditor();
    setNotice(`${noteLabel(item.id)} deleted from the draft batch.`);
  }
  function reattach(id: string) {
    if (!target || pending) return;
    setState(s => {
      const existing = s.captures.find(capture => capture.html === c.html && capture.width === width && capture.height === height);
      const capture = existing ?? { id: randomUuid(), html: c.html, width, height, capturedAt: new Date().toISOString() };
      return { captures: existing ? s.captures : [...s.captures, capture], items: s.items.map(i => i.id === id ? {
        ...i, previousTargets: [...(i.previousTargets ?? []), { captureId: i.captureId, target: i.target }],
        captureId: capture.id, target, status: "reopened",
      } : i) };
    });
    resetEditor(); setNotice(`${noteLabel(id)} reattached. Original evidence is retained in JSON.`);
  }
  function exportFile(format: "md" | "json") {
    downloadFeedback(`feedback.${format}`, format === "md" ? feedbackMarkdown(c.id, state) : JSON.stringify({ ...feedbackPayload(c.id, state), captures: state.captures }, null, 2), format === "md" ? "text/markdown" : "application/json");
  }
  const ready = state.items.filter(i => hasFeedbackContent(i) && isDraftNote(i) && state.captures.some(capture => capture.id === i.captureId && capture.html === c.html)).length;
  const displayedTarget = target && element.current?.isConnected ? captureTarget(element.current, width, height) : target;
  const bounds = displayedTarget ? { ...displayedTarget.bounds, x: displayedTarget.bounds.x + (displayedTarget.scroll.x - scroll.x) / width, y: displayedTarget.bounds.y + (displayedTarget.scroll.y - scroll.y) / height } : null;
  const box = (b: FeedbackTarget["bounds"]) => ({ left: b.x * width, top: b.y * height, width: b.width * width, height: b.height * height });
  const editing = !!(target || selectedNote);
  const sent = phase === "review" && !pending && !ready && state.items.length > 0 && state.items.every(i => !isDraftNote(i));
  const staleNotes = state.items.filter(i => state.captures.find(capture => capture.id === i.captureId)?.html !== c.html);
  const attachmentId = staleNotes.some(i => i.id === attachId) ? attachId : staleNotes[0]?.id;
  const step = phase === "review" ? 2 : editing ? 1 : 0;
  return <section className="html-feedback" aria-label="HTML feedback workspace">
    <header className="hf-header">
      <div><span className="hf-eyebrow">Design feedback</span><h2>{c.title ?? "HTML review"}</h2></div>
      <div className="hf-progress" aria-label="Review progress">{["Select a target", "Write a note", "Review & send"].map((label, i) =>
        <span key={label} aria-current={step === i ? "step" : undefined} data-complete={step > i}><b aria-hidden="true">{step > i ? <Check size={12} /> : i + 1}</b>{label}</span>)}</div>
    </header>
    <div className="hf-toolbar" aria-label="Review controls">
      <div className="hf-modes" role="group" aria-label="Selection mode">
        {([ ["element", "Select", MousePointer2], ["region", "Draw region", Scan], ["browse", "Browse", Hand] ] as const).map(([m, label, Icon]) =>
          <button key={m} ref={m === "element" ? selectButton : undefined} type="button" disabled={pending || inlineEditing} aria-pressed={mode === m} onClick={() => { setMode(m); setHover(null); }}><Icon size={15} aria-hidden="true" />{label}</button>)}
      </div>
      <label className="hf-viewport">Viewport <select value={width} disabled={pending} onChange={e => { if (canLeaveEditor()) setWidth(Number(e.target.value)); }}><option value={360}>Mobile · 360</option><option value={768}>Tablet · 768</option><option value={1200}>Desktop · 1200</option></select></label>
      <details className="hf-picker"><summary>Choose target</summary><label>Keyboard target picker<select value="" disabled={pending} onChange={e => { if (e.target.value === "") return; const el = choices[Number(e.target.value)]; if (el) select(el); }}><option value="">Select an element…</option>{choices.map((el, i) => <option key={i} value={i}>{el.localName} · {(el.textContent || el.getAttribute("alt") || "visual element").trim().slice(0, 70)}</option>)}</select></label></details>
    </div>
    <div className="hf-layout" data-editing={editing} data-phase={phase} data-inline={inlineEditing}>
      <div className="hf-preview">
        <div className="hf-canvas-caption"><span>{inlineEditing ? "Editing text · click away to save locally · Cancel or Esc to discard" : mode === "region" ? "Drag across the preview to mark an area" : mode === "browse" ? "Scroll to explore · switch to Select to annotate" : "Click an element or region to leave a note"}</span><span className="hf-legend"><i /> Selected <i /> Hover</span></div>
      <div className="hf-canvas-scroll" ref={canvasScroll}><div className="hf-canvas-stage" style={{ width }}><div className="hf-canvas" data-mode={mode} style={{ width, height }}>
        <iframe ref={frame} title="HTML review viewport" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={srcDoc}
          onLoad={() => { setLoaded(n => n + 1); setScroll({ x: 0, y: 0 }); }} style={{ width, height }} />
        {drag && <div className="hf-outline hf-region-draft" aria-hidden="true" style={box(drag)} />}
        {hover && <div className="hf-hover-outline" aria-hidden="true" style={box(hover)} />}
        {bounds && <div className="hf-outline" aria-hidden="true" style={box(bounds)} />}
        {state.items.map(item => {
          const capture = state.captures.find(capture => capture.id === item.captureId);
          if (capture?.html !== c.html || capture.width !== width || undo.current) return null;
          const previewElement = previews.element(item.id);
          const displayed = previewElement ? captureTarget(previewElement, width, height) : item.target;
          const b = { ...displayed.bounds, x: displayed.bounds.x + (displayed.scroll.x - scroll.x) / width, y: displayed.bounds.y + (displayed.scroll.y - scroll.y) / height };
          return <div key={item.id} className="hf-annotation" aria-hidden="true" style={box(b)} data-selected={selectedId === item.id} />;
        })}
      </div>
        {bounds && bounds.y <= 1 && bounds.y + bounds.height >= 0 && <div className="hf-selection-label" role="group" aria-label="Selection actions"
          style={{ left: Math.max(0, Math.min(bounds.x * width, width - 200)), top: 36 + Math.max(0, bounds.y * height) - 34 }}>
          <span>{target?.kind === "region" ? "Selected region" : "Selected text"}</span>
          {target?.kind === "element" && <button type="button" aria-label={inlineEditing ? "Cancel text edit" : "Edit selected text"}
            title={inlineEditing ? "Cancel text edit" : "Edit selected text"} aria-pressed={inlineEditing}
            disabled={readOnly || (!inlineEditing && !element.current?.textContent?.trim() && !preview?.before.trim()) || element.current?.namespaceURI !== "http://www.w3.org/1999/xhtml"}
            onPointerDown={e => { if (inlineEditing) e.preventDefault(); }}
            onClick={inlineEditing ? cancelInline : editText}>{inlineEditing ? <><X size={14} aria-hidden="true" />Cancel</> : <Pencil size={14} aria-hidden="true" />}</button>}
        </div>}
      </div></div>
        <div className="hf-preview-foot"><ShieldCheck size={13} aria-hidden="true" /> Static preview · scripts, navigation and network blocked</div>
      </div>
      <aside className="hf-sidebar" aria-label="Feedback notes" data-expanded={sheetOpen}>
        <button type="button" className="hf-sheet-toggle" aria-expanded={sheetOpen} onClick={() => setSheetOpen(!sheetOpen)}><span>{sheetOpen ? "Show more preview" : editing ? "Continue note" : "Show feedback"}</span><ChevronDown size={16} aria-hidden="true" /></button>
        <div className="hf-sidebar-body">
          {phase === "review" ? <div className="hf-review-intro">
            <h3 ref={reviewHeading} tabIndex={-1}>{sent ? "Feedback sent" : "Ready to send?"}</h3>
            <button type="button" disabled={pending} onClick={() => { setPhase("annotate"); setMode("element"); resetEditor(); }}><ArrowLeft size={14} aria-hidden="true" />Continue annotating</button>
          </div> : editing ? <div className="hf-editor">
            <div className="hf-editor-heading"><h3>{selectedNote ? `Note ${noteLabel(selectedNote.id)}` : "Your feedback"}</h3><span className="hf-edit-status">{readOnly ? "Read-only" : feedback.storageError ? "In memory only" : dirty ? "Editing" : selectedNote ? "Auto-saved locally" : "New"}</span></div>
            <div className="hf-target-summary" data-active={!!target} title={(target ?? selectedNote?.target)?.text}>
              <Crosshair size={14} aria-hidden="true" /><span>{target ? `${target.kind === "element" ? target.tag : "Region"} selected` : "Captured target"} · {(target ?? selectedNote?.target)?.text || "Page region"}</span>
              {!selectedNote && <button type="button" disabled={readOnly || !element.current?.parentElement || element.current?.parentElement === frame.current?.contentDocument?.body} onClick={() => { if (element.current?.parentElement) select(element.current.parentElement); }}>Parent</button>}
            </div>
            {selectedNote && !target && <p className="hf-help">Target not highlighted at this revision. Saved evidence is retained.</p>}
            <label className="hf-feedback-field">What should change?<textarea ref={input} disabled={readOnly} maxLength={4000} value={request} onChange={e => { setRequest(e.target.value); persist(e.target.value); }} placeholder="Describe your feedback, changes, or what success looks like…" /></label>
            <div className="hf-inline-actions">
              {preview && <button type="button" disabled={readOnly} onClick={undoPreview}>Undo preview</button>}
            </div>
            {attachmentId && target && !selectedNote && !dirty && <div className="hf-reattach"><select aria-label="Earlier note" value={attachmentId} onChange={e => setAttachId(e.target.value)}>{staleNotes.map(i => <option key={i.id} value={i.id}>{noteLabel(i.id)} · {i.request.slice(0, 40)}</option>)}</select><button type="button" disabled={pending} onClick={() => reattach(attachmentId)}>Attach selected target</button></div>}
          </div> : !state.items.length ? <div className="hf-empty">
            <MessageSquarePlus size={28} aria-hidden="true" /><h3>Start with a selection</h3><p>Click an element or draw a region, then leave your feedback.</p><span className="hf-help">Your batch is empty. Nothing is sent until you submit.</span>
          </div> : <div className="hf-saved-heading"><h3>Saved feedback</h3><span className="hf-help">Select another target to add a note.</span></div>}
          {(phase === "review" || !editing) && state.items.length > 0 && <HtmlFeedbackNotes c={c} state={state} selectedId={selectedId} pending={pending} onInspect={inspect} onDelete={remove}
            onStatus={(id, status) => setState(s => ({ ...s, items: s.items.map(i => i.id === id ? { ...i, status, ...(status === "verified" ? { verifiedHtml: c.html } : {}) } : i) }))} />}
          <p className="hf-notice" role="status">{notice}</p>
        </div>
        <div className="hf-batch-footer">
          {phase === "annotate" && editing && <>
            <div className="hf-editor-actions"><button type="button" disabled={readOnly || (!selectedNote && !dirty)} onPointerDown={e => e.preventDefault()} onClick={discardCurrent}>Discard changes</button>
              <button type="button" disabled={pending} onClick={() => { if (canLeaveEditor()) resetEditor(); }}>New note</button></div>
          </>}
          {phase === "review" ? <>
            {!sent && <button className="hf-primary" type="button" disabled={!ready || dirty || pending || !feedback.canSend} onClick={feedback.send}>{pending ? "Sending…" : `Submit batch (${ready} ${ready === 1 ? "note" : "notes"})`}<ArrowRight size={16} aria-hidden="true" /></button>}
            {!ready && !sent && <p className="hf-help">No written current-revision notes to send. Add a note to a region, reattach earlier notes, or continue annotating.</p>}
          </> : <button className="hf-primary" type="button" disabled={(!state.items.length && !dirty) || pending} onClick={() => { if (!canLeaveEditor()) return; restorePreview(); setPhase("review"); setSheetOpen(true); setNotice(""); }}>{pending ? "Sending…" : `Review ${state.items.length} ${state.items.length === 1 ? "note" : "notes"}`}<ArrowRight size={16} aria-hidden="true" /></button>}
          {!feedback.canSend && phase === "review" && <p className="hf-help">No agent connected. Export your notes below.</p>}
          <p className="hf-delivery" role="status">{feedback.delivery}</p>
          {pending && feedback.delivery.includes("not confirmed") && <button type="button" onClick={feedback.resetDelivery}>I checked the conversation — allow retry</button>}
          {feedback.storageError && <p role="alert">{feedback.storageError}</p>}
          <details className="hf-export"><summary>Export & storage</summary><div className="hf-actions"><button type="button" disabled={!state.items.length} onClick={() => exportFile("md")}>Export Markdown</button><button type="button" disabled={!state.items.length} onClick={() => exportFile("json")}>Export JSON</button></div>
            <p className="hf-help">Notes auto-save in this browser. Discard changes resets the selected object. Nothing is sent until you submit. JSON includes original HTML, not screenshots or source mapping.</p></details>
        </div>
      </aside>
    </div>
  </section>;
}
