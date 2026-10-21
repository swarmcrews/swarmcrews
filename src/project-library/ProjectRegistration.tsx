import { NavigationDraft } from "../navigation-drafts.tsx";
import { useEffect, useState, useCallback } from "react";
import { getHarnessReadiness, type HarnessReadinessSnapshot } from "../api.ts";
import { browserLogger } from "../logging.ts";
import { ProjectGitWarning } from "../ProjectGitWarning.tsx";
import { RepositoryPathPicker } from "../components/RepositoryPathPicker.tsx";
import { ArrowRight, FolderOpen, Plus, RefreshCw } from "lucide-react";
import { useProjectInitialization } from "../project-recovery/use-project-initialization.ts";
import { ProjectFeedback } from "../project-recovery/ProjectFeedback.tsx";
const log = browserLogger.child("project-registration");
export function ProjectRegistration({ onOpenProject, empty }: { onOpenProject: (id: string, path: string, acknowledgement?: string) => void; empty: boolean }) {
  const [folderPath, setFolderPath] = useState("");
  const [choosingFolder, setChoosingFolder] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<{ id: string; path: string; acknowledgement?: string } | null>(null);
  const initialization = useProjectInitialization((id, path, acknowledgement) => {
    setCompleted(true); setPendingOpen({ id, path, ...(acknowledgement !== undefined ? { acknowledgement } : {}) });
  });
  useEffect(() => {
    if (!pendingOpen) return;
    setPendingOpen(null); onOpenProject(pendingOpen.id, pendingOpen.path, pendingOpen.acknowledgement);
  }, [pendingOpen, onOpenProject]);
  const { creating, gitDecision: pendingGitDecision } = initialization;
  const [mode, setMode] = useState<"open" | "create">("open");
  const [newName, setNewName] = useState("");
  const [readiness, setReadiness] = useState<HarnessReadinessSnapshot | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);

  useEffect(() => {
    let active = true;
    void getHarnessReadiness().then((result) => {
      if (active) setReadiness(result);
    }).catch((error: unknown) => {
      log.warn("harness_readiness_load_failed", { error });
    });
    return () => {
      active = false;
    };
  }, []);

  const retryReadiness = useCallback(async () => {
    setCheckingReadiness(true);
    try {
      setReadiness(await getHarnessReadiness(true));
    } catch (err) {
      log.warn("harness_readiness_retry_failed", { error: err });
    } finally {
      setCheckingReadiness(false);
    }
  }, []);

  const handleInitialize = () => {
    const path = folderPath.trim();
    if (choosingFolder || !path || creating || readiness?.ready === false) return;
    void initialization.initialize({ mode, path, ...(newName.trim() ? { name: newName.trim() } : {}) });
  };

  const projectActionDisabled = creating || choosingFolder || !folderPath.trim() || readiness?.ready === false;
  const hasLoadedEmptyProjects = empty;
  return (
        <section className="project-list-card" aria-labelledby="project-action-title">
          <NavigationDraft scope="project-registration" dirty={!completed && (!!folderPath || !!newName)} pending={!completed && creating} />
          <div className="project-list-card__heading">
            <span className="project-list-card__icon" aria-hidden="true">
              {mode === "open" ? <FolderOpen size={15} /> : <Plus size={15} />}
            </span>
            <div>
              <h2 id="project-action-title">
                {mode === "open" ? "Open a repository" : "Register a repository"}
              </h2>
              <p>
                {mode === "open"
                  ? "Connect a repository to resume its Canvas and work history."
                  : "Register this repository as a project. Agents only start when you launch work."}
              </p>
            </div>
          </div>

          <div className="project-list-card__body">
            <div className="project-list-mode" role="group" aria-label="Project action">
              <button
                type="button"
                disabled={creating}
                aria-pressed={mode === "open"}
                onClick={() => {
                  setMode("open");
                  initialization.clear();
                }}
              >
                <FolderOpen size={13} aria-hidden="true" />
                Open repository
              </button>
              <button
                type="button"
                disabled={creating}
                aria-pressed={mode === "create"}
                onClick={() => {
                  setMode("create");
                  initialization.clear();
                }}
              >
                <Plus size={13} aria-hidden="true" />
                Register repository
              </button>
            </div>

            <div className="project-list-fields">
              <RepositoryPathPicker
                className="project-list-field"
                value={folderPath}
                defaultOpen={hasLoadedEmptyProjects}
                onNewFolder={() => setMode("create")}
                disabled={creating}
                placeholder={mode === "open" ? "/path/to/existing/project..." : "/path/to/new/project..."}
                onChange={(path) => {
                  setCompleted(false); setFolderPath(path);
                  initialization.clear();
                }}
                onEditingChange={setChoosingFolder}
              />
              {mode === "create" && (
                <label className="project-list-field">
                  <span>Project name</span>
                  <input
                    type="text"
                    disabled={creating}
                    placeholder="Project name (optional, defaults to folder name)"
                    value={newName}
                    onChange={(e) => {
                      setCompleted(false); setNewName(e.target.value);
                      initialization.clear();
                    }}
                  />
                </label>
              )}
              <button
                type="button"
                className="project-list-primary-action"
                onClick={handleInitialize}
                disabled={projectActionDisabled}
              >
                {creating ? (mode === "open" ? "Opening..." : "Registering...") : mode === "open" ? "Open" : "Create"}
                {!creating && <ArrowRight size={14} aria-hidden="true" />}
              </button>
            </div>

            {!completed && (folderPath || newName) && <button type="button" disabled={creating} onClick={() => { setFolderPath(""); setNewName(""); setChoosingFolder(true); initialization.clear(); }}>Discard registration draft</button>}

            {initialization.state.status === "error" && <ProjectFeedback error focusAction actions={<>
              <button type="button" disabled={choosingFolder} onClick={initialization.retry}>Retry</button>
              <button type="button" onClick={initialization.clear}>Cancel</button>
            </>}>
              Couldn’t {mode === "open" ? "open" : "register"} repository. Your path and name are preserved. {initialization.state.error}
            </ProjectFeedback>}

            {pendingGitDecision && !choosingFolder && (
              <ProjectGitWarning
                busy={creating}
                variant="desktop"
                onContinue={() => void initialization.initialize(pendingGitDecision, "continue_without_git")}
                onInitialize={() => void initialization.initialize(pendingGitDecision, "initialize")}
              />
            )}

            {readiness?.ready === false && (
              <div role="alert" className="project-list-alert">
                <span>Sign in to Claude or Codex to open or create a project.</span>
                <button
                  type="button"
                  onClick={() => void retryReadiness()}
                  disabled={checkingReadiness}
                >
                  <RefreshCw size={12} aria-hidden="true" />
                  {checkingReadiness ? "Checking…" : "Check again"}
                </button>
              </div>
            )}
          </div>
        </section>

  );
}
