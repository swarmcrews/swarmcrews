import { CrewIcon } from "./components/CrewIcon.tsx";
import { LeaderStatusIcon } from "./nodes/leader/LeaderStatusIcon.tsx";
import { Brand } from "./components/Brand.tsx";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useProjectList } from "./use-project-list.ts";
import {
  deleteProject,
  getHarnessReadiness,
  type ProjectSummary,
  type HarnessReadinessSnapshot,
} from "./api.ts";
import { browserLogger } from "./logging.ts";
import type { ProjectActivitySummary } from "../shared/project-activity.ts";
import { ProjectSessionActivity } from "./ProjectSessionActivity.tsx";
import { ProjectGitWarning } from "./ProjectGitWarning.tsx";
import { ProjectsTutorial } from "./ProjectsTutorial.tsx";
import { RepositoryPathPicker } from "./components/RepositoryPathPicker.tsx";
import { ConfirmModal } from "./components/ConfirmModal.tsx";
import {
  ArrowRight,
  Clock3,
  FolderOpen,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import "./project-list.css";
import { useProjectInitialization } from "./project-recovery/use-project-initialization.ts";
import { useProjectOperation } from "./project-recovery/use-project-operation.ts";
import { ProjectFeedback } from "./project-recovery/ProjectFeedback.tsx";

const log = browserLogger.child("project-list");

interface ProjectListProps {
  onOpenProject: (id: string, projectPath: string, acknowledgement?: string) => void;
}

export function ProjectList({ onOpenProject }: ProjectListProps) {
  const [activity, setActivity] = useState<ProjectActivitySummary[]>([]);
  const { projects, setProjects, loading, error: projectsLoadFailed, reload: loadProjects } = useProjectList();
  const [folderPath, setFolderPath] = useState("");
  const initialization = useProjectInitialization(onOpenProject);
  const { creating, gitDecision: pendingGitDecision } = initialization;
  const removal = useProjectOperation();
  const [removalTarget, setRemovalTarget] = useState<ProjectSummary | null>(null);
  const [mode, setMode] = useState<"open" | "create">("open");
  const [newName, setNewName] = useState("");
  const [readiness, setReadiness] = useState<HarnessReadinessSnapshot | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [projectToRemove, setProjectToRemove] = useState<ProjectSummary | null>(null);

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

  const activityByProject = useMemo(
    () => new Map(activity.map((summary) => [summary.projectId, summary])),
    [activity],
  );

  const handleInitialize = () => {
    const path = folderPath.trim();
    if (!path || creating || readiness?.ready === false) return;
    void initialization.initialize({ mode, path, ...(newName.trim() ? { name: newName.trim() } : {}) });
  };

  const handleRemoveRecent = async (project: ProjectSummary) => {
    if (removal.pending) return;
    setProjectToRemove(null);
    setRemovalTarget(project);
    const result = await removal.run(() => deleteProject(project.id));
    if (result) setProjects((prev) => prev.filter((p) => p.id !== project.id));
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  };

  const projectActionDisabled = creating || !folderPath.trim() || readiness?.ready === false;
  const hasLoadedEmptyProjects = !loading && !projectsLoadFailed && projects.length === 0;

  return (
    <main className="project-list-page">
      {!loading && <ProjectSessionActivity projectIds={projects.map((p) => p.id)} onSummaryChange={setActivity} />}
      <div className="project-list-shell">
        <header className="project-list-header">
          <div className="project-list-brand"><Brand /></div>
          <div className="project-list-heading">
            <span>Workspace</span>
            <h1>Projects</h1>
            {!loading && projects.length > 0 && <ProjectsTutorial />}
            <p>Open a repository to resume its Canvas, or register one as a new project.</p>
          </div>
        </header>

        {hasLoadedEmptyProjects && <ProjectsTutorial prominent />}

        <section className="project-list-card" aria-labelledby="project-action-title">
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
                  ? "A project connects Swarmcrews to a repository. Open one to resume its Canvas; Canvas workspaces such as Global organize work inside it."
                  : "Create a project that connects Swarmcrews to this repository and its Canvas."}
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
                disabled={creating}
                placeholder={mode === "open" ? "/path/to/existing/project..." : "/path/to/new/project..."}
                onChange={(path) => {
                  setFolderPath(path);
                  initialization.clear();
                }}
                onSubmit={handleInitialize}
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
                      setNewName(e.target.value);
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

            {initialization.state.status === "error" && <ProjectFeedback error focusAction actions={<>
              <button type="button" onClick={initialization.retry}>Retry</button>
              <button type="button" onClick={initialization.clear}>Cancel</button>
            </>}>
              Couldn’t {mode === "open" ? "open" : "register"} repository. Your path and name are preserved. {initialization.state.error}
            </ProjectFeedback>}

            {pendingGitDecision && (
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

        <section className="project-list-card" aria-labelledby="recent-projects-title">
          <div className="project-list-card__heading project-list-card__heading--split">
            <div className="project-list-card__heading-copy">
              <span className="project-list-card__icon" aria-hidden="true">
                <Clock3 size={15} />
              </span>
              <div>
                <h2 id="recent-projects-title">Recent projects</h2>
                <p>Jump back into a canvas from this machine.</p>
              </div>
            </div>
            {!loading && projects.length > 0 && (
              <span className="project-list-count">{projects.length}</span>
            )}
          </div>

          <div className="project-list-card__body">
            {removalTarget && removal.state.status !== "idle" && <ProjectFeedback focusAction={removal.state.status !== "pending"} error={removal.state.status === "error"} actions={removal.state.status === "error" ? <>
              <button type="button" onClick={() => setProjectToRemove(removalTarget)}>Retry removal</button>
              <button type="button" onClick={removal.clear}>Dismiss</button>
            </> : removal.state.status === "success" ? <button type="button" onClick={removal.clear}>Dismiss</button> : undefined}>
              {removal.state.status === "pending" ? `Removing “${removalTarget.name}”…` : removal.state.status === "error" ? <>Couldn’t remove “{removalTarget.name}”. The recent-project entry is unchanged. {removal.state.error}</> : `Removed “${removalTarget.name}” from recent projects. Your files remain on disk.`}
            </ProjectFeedback>}
            {loading ? (
              <div className="project-list-state project-list-state--loading">Loading...</div>
            ) : projectsLoadFailed ? (
              <div role="alert" className="project-list-alert">
                <span>Couldn’t load recent projects. Check your connection and try again.</span>
                <button type="button" onClick={() => void loadProjects()}>
                  <RefreshCw size={12} aria-hidden="true" />
                  Retry
                </button>
              </div>
            ) : projects.length === 0 ? (
              <div className="project-list-state">
                <strong>No recent projects</strong>
                <p>Open a folder to get started.</p>
                <small>
                  Worktree isolation is optional, merges require approval, and Swarmcrews keeps project state in its private workspace home.
                  A safe first task is: “Summarize this repository’s structure without changing files.”
                </small>
              </div>
            ) : (
              <div className="project-list-recents">
                {projects.map((p) => {
                  const summary = activityByProject.get(p.id);
                  const countKnown = summary !== undefined;
                  const activeLeaders = summary?.activeLeaders ?? 0;
                  const activeCrew = summary?.activeCrew ?? 0;
                  const hasActiveSessions = activeLeaders > 0 || activeCrew > 0;
                  const leaderLabel = `${activeLeaders} active leader${activeLeaders === 1 ? "" : "s"}`;
                  const activeLabel = `${leaderLabel} and ${activeCrew} crew`;

                  return (
                    <div
                      className="project-list-recent"
                      key={p.id}
                    >
                      <button
                        className="project-list-recent__open"
                        type="button"
                        aria-label={`Open ${p.name}`}
                        disabled={removal.pending && removalTarget?.id === p.id}
                        onClick={() => onOpenProject(p.id, p.path)}
                      >
                      <span
                        className={`project-list-recent__activity ${hasActiveSessions ? "project-list-recent__activity--active" : "project-list-recent__activity--sleeping"}`}
                        role="img"
                        aria-label={!countKnown ? `${p.name} activity unavailable` : hasActiveSessions ? `${p.name} has ${activeLabel}` : `${p.name} is sleeping with no active sessions`}
                      >
                        {hasActiveSessions ? (
                          activeLeaders > 0 ? <LeaderStatusIcon size={22} active decorative /> : <CrewIcon size={18} aria-hidden="true" />
                        ) : (
                          <span className="project-list-recent__zzz" aria-hidden="true">{countKnown ? "ZZZ" : "…"}</span>
                        )}
                      </span>
                      <span className="project-list-recent__details">
                        <strong>{p.name}</strong>
                        <span className={`project-list-recent__session-count ${hasActiveSessions ? "project-list-recent__session-count--active" : ""}`}>
                          {countKnown ? <>
                            <span className="project-list-recent__metric">
                              <LeaderStatusIcon size={12} active={activeLeaders > 0} decorative />
                              {leaderLabel}
                            </span>
                            <span className="project-list-recent__metric" title="Minions currently starting or executing">
                              <CrewIcon size={12} aria-hidden="true" />
                              {activeCrew} crew
                            </span>
                          </> : "Activity unavailable"}
                        </span>
                        <span className="project-list-recent__path">{p.path}</span>
                        <small>
                          {formatDate(p.lastOpened)}
                          {!p.hasSidecar && <em>No canvas data</em>}
                        </small>
                      </span>
                      <ArrowRight className="project-list-recent__arrow" size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="project-list-remove"
                        disabled={removal.pending}
                        aria-label="Remove"
                        title="Remove from recent projects"
                        onClick={(e) => {
                          e.stopPropagation();
                          setProjectToRemove(p);
                        }}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        <span>Remove</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
      {projectToRemove && (
        <ConfirmModal
          title={`Remove "${projectToRemove.name}" from recent projects?`}
          description="This removes the project from your recent projects list. Your project folder and files will remain on disk. You can open the folder again later."
          onClose={() => setProjectToRemove(null)}
          actions={[{
            label: "Remove project",
            variant: "danger",
            onClick: () => void handleRemoveRecent(projectToRemove),
          }]}
        />
      )}
    </main>
  );
}
