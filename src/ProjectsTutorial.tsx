import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, Flag, Gamepad2, Trophy, X } from "lucide-react";
import "./projects-tutorial.css";
import { TutorialCanvas } from "./TutorialCanvas.tsx";

const missions = [
  { title: "Brief your leader", objective: "Type a request for a welcome page design brief into the leader’s prompt, then press Enter or Start.", hint: "This is the canvas leader’s prompt. Enter sends your message; Shift + Enter adds a new line. The leader’s response here is simulated.", success: "Your leader has created a design brief in its Dashboard." },
  { title: "Drag to connect", objective: "Drag the Share context chevron on the leader’s right edge onto empty canvas. Release, then choose Dashboard to create a connected leader.", hint: "The output shares Dashboard, Lean, or Full context. You can also drag it to an idle leader’s Context input on its lower left edge. Keyboard: focus the output, press Enter, then focus the drop area or input and press Enter.", success: "The new leader is connected. Its first prompt will include the shared context." },
  { title: "Ask for a task graph", objective: "In the connected leader’s prompt, type: “Build a task graph to implement the welcome page and verify accessibility.” Then send it.", hint: "The leader builds the graph and assigns the tasks. Describe the outcome and ask for a task graph or crew in your message.", success: "The leader has generated an execution plan from your request." },
  { title: "Review and start", objective: "Inspect the leader’s execution plan. Open Details to see the tasks and dependencies, or Adjust to request changes. Choose Start on the plan to run it.", hint: "This practice uses a plan review gate. In a real project, whether execution waits for Start depends on your orchestration and review settings.", success: "Practice run complete. You’ve followed the canvas workflow from prompt to connected leader to task graph." },
] as const;

/** Self-contained practice: no project, filesystem, or agent APIs are called. */
function TutorialMission({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [playthrough, setPlaythrough] = useState(0);
  const finished = step === missions.length;
  const mission = missions[Math.min(step, missions.length - 1)]!;
  const progress = finished ? missions.length : step + Number(completed);

  useLayoutEffect(() => {
    const trigger = document.activeElement;
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  useLayoutEffect(() => { headingRef.current?.focus(); }, [step]);

  return createPortal(
    <dialog ref={dialogRef} className="projects-tutorial" aria-labelledby="tutorial-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="tutorial-header">
        <span className="tutorial-eyebrow"><Gamepad2 size={16} aria-hidden="true" /> Swarmcrews tutorial</span>
        <button type="button" className="tutorial-close" aria-label="Exit tutorial" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="tutorial-layout">
        <aside className="tutorial-missions" aria-label="Mission progress">
          <span className="tutorial-eyebrow">Your first mission</span>
          <h2>From idea to done.</h2>
          <p>Learn by doing in a practice workspace.</p>
          <progress aria-label="Tutorial progress" value={progress} max={missions.length} />
          <span className="tutorial-progress-label">{progress} of {missions.length} objectives complete</span>
          <ol>
            {missions.map((item, index) => (
              <li key={item.title} aria-current={index === step ? "step" : undefined} data-complete={index < progress}>
                <span className="tutorial-step-number" aria-hidden="true">{index < progress ? <Check size={14} /> : index + 1}</span>
                <span>{item.title}{index < progress && <span className="tutorial-sr-only"> — complete</span>}</span>
              </li>
            ))}
          </ol>
          <small>Practice mode · No account needed<br />No real files changed or agents started.</small>
        </aside>
        <section className="tutorial-play">
          {finished ? (
            <div className="tutorial-finish">
              <Trophy className="tutorial-trophy" size={48} aria-hidden="true" />
              <span className="tutorial-eyebrow">Mission complete</span>
              <h1 id="tutorial-title" ref={headingRef} tabIndex={-1}>You’re ready to lead.</h1>
              <p>You prompted a leader, dragged its output to share context, asked for a task graph, and started the leader’s plan.</p>
              <div className="tutorial-next-tip"><Flag size={20} aria-hidden="true" /><p><strong>Your next mission</strong>Open or create a project, then give your first leader a small task. Try: “Summarize this repository’s structure without changing files.”</p></div>
              <button type="button" className="tutorial-primary" onClick={onClose}>Back to projects <ArrowRight size={16} aria-hidden="true" /></button>
              <button type="button" className="tutorial-link" onClick={() => { setStep(0); setCompleted(false); setPlaythrough(playthrough + 1); }}>Play again</button>
            </div>
          ) : (
            <>
              <div className="tutorial-objective">
                <span className="tutorial-eyebrow">Objective {step + 1} / {missions.length}</span>
                <h1 id="tutorial-title" ref={headingRef} tabIndex={-1}>{mission.title}</h1>
                <p>{mission.objective}</p>
              </div>
              <TutorialCanvas key={playthrough} step={step} onComplete={() => setCompleted(true)} />
              <p className="tutorial-hint">{mission.hint}</p>
              <footer className="tutorial-footer">
                <p role="status">{completed ? <><Check size={17} aria-hidden="true" />{mission.success}</> : "Complete the highlighted action to continue."}</p>
                <button type="button" className="tutorial-primary" disabled={!completed} onClick={() => { setStep(step + 1); setCompleted(false); }}>{step === missions.length - 1 ? "Finish mission" : "Next objective"}<ArrowRight size={16} aria-hidden="true" /></button>
              </footer>
            </>
          )}
        </section>
      </div>
    </dialog>, document.body,
  );
}

export function ProjectsTutorial({ prominent = false }: { prominent?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    {prominent ? (
      <section className="tutorial-entry" aria-label="Learn Swarmcrews">
        <div className="tutorial-entry-icon"><Gamepad2 size={27} aria-hidden="true" /></div>
        <div className="tutorial-entry-copy"><span className="tutorial-eyebrow">Your first mission starts here</span><h2>Learn to lead a crew.</h2><p>Try a guided, hands-on tutorial. Four small objectives, one practice workspace.</p><button type="button" className="tutorial-primary" onClick={() => setOpen(true)}>Start tutorial <ArrowRight size={16} aria-hidden="true" /></button><small>No setup needed · About 2 minutes</small></div>
      </section>
    ) : <button type="button" className="tutorial-link" onClick={() => setOpen(true)}>Tutorial</button>}
    {open && <TutorialMission onClose={() => setOpen(false)} />}
  </>;
}
