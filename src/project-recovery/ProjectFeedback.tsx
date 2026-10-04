import { useEffect, useRef, type ReactNode } from "react";
import { Brand } from "../components/Brand.tsx";
import "./project-recovery.css";

export function ProjectFeedback({ error = false, children, actions, focusAction = false }: { error?: boolean; children: ReactNode; actions?: ReactNode; focusAction?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusAction) ref.current?.querySelector("button")?.focus(); }, [focusAction]);
  return <div ref={ref} className="project-feedback" role={error ? "alert" : "status"}>
    <div className="project-feedback__copy">{children}</div>
    {actions && <div className="project-feedback__actions">{actions}</div>}
  </div>;
}

export function ProjectLoadError({ error, path, onRetry, onProjects, acknowledgement = "" }: { error: string; path: string; onRetry: () => void; onProjects: () => void; acknowledgement?: string }) {
  const retryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { retryRef.current?.focus(); }, []);
  return <main className="project-load-error">
    <div className="project-load-error__content">
      <Brand />
      <h1>Couldn’t open workspace</h1>
      {acknowledgement && <p role="status">{acknowledgement}</p>}
      <p>This load request hasn’t changed your project files. Check the server connection, then retry or return to Projects.</p>
      <p className="project-load-error__path">{path}</p>
      <ProjectFeedback error actions={<><button ref={retryRef} type="button" onClick={onRetry}>Retry</button><button type="button" onClick={onProjects}>Projects</button></>}>
        {error}
      </ProjectFeedback>
    </div>
  </main>;
}
