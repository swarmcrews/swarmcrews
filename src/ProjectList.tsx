import { CrewIcon } from "./components/CrewIcon.tsx";
import { LeaderStatusIcon } from "./nodes/leader/LeaderStatusIcon.tsx";
import { Brand } from "./components/Brand.tsx";
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  listProjects,
  checkProjectGit,
  createProject,
  openProject,
  deleteProject,
  getHarnessReadiness,
  type ProjectSummary,
  type HarnessReadinessSnapshot,
  type ProjectGitAction,
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

const log = browserLogger.child("project-list");

interface ProjectListProps {
  onOpenProject: (id: string, projectPath: string) => void;
}

type PendingGitDecision = { mode: "open" | "create"; path: string; name?: string };

export function ProjectList({ onOpenProject }: ProjectListProps) {
  const [activity, setActivity] = useState<ProjectActivitySummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [folderPath, setFolderPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<"open" | "create">("open");
  const [newName, setNewName] = useState("");
  const [readiness, setReadiness] = useState<HarnessReadinessSnapshot | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [pendingGitDecision, setPendingGitDecision] = useState<PendingGitDecision | null>(null);
  const [projectToRemove, setProjectToRemove] = useState<ProjectSummary | null>(null);

  useEffect(() => {
    let active = true;
    void listProjects().then((result) => {
      if (active) setProjects(result);
    }).catch((error: unknown) => {
      log.error("projects_load_failed", { error });
    }).finally(() => {
      if (active) setLoading(false);
    });
    void getHarnessReadiness().then((result) => {
      if (active) setReadiness(result);
    }).catch((error: unknown) => {
      log.warn("harness_readiness_load_failed", { error });
    });
    return () => { active = false; };
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

  const finishProjectInitialization = async (decision: PendingGitDecision, gitAction?: ProjectGitAction) => {
    setCreating(true);
    try {
      const project = decision.mode === "open"
        ? await (gitAction ? openProject(decision.path, gitAction) : openProject(decision.path))
        : await (gitAction
          ? createProject(decision.name ?? "Untitled", decision.path, gitAction)
          : createProject(decision.name ?? "Untitled", decision.path));
      onOpenProject(project.id, project.path);
    } catch (err) {
      const action = decision.mode === "open" ? "open" : "create";
      log.error(`project_${action}_failed`, { error: err });
      alert(`Failed to ${action} project: ${err}`);
    } finally {
      setCreating(false);
    }
  };

  const preflightProjectInitialization = async (decision: PendingGitDecision) => {
    setCreating(true);
    setPendingGitDecision(null);
    try {
      const status = await checkProjectGit(decision.path);
      if (!status.isRepository) {
        setPendingGitDecision(decision);
        return;
      }
      await finishProjectInitialization(decision);
    } catch (err) {
      const action = decision.mode === "open" ? "open" : "create";
      log.error(`project_${action}_preflight_failed`, { error: err });
      alert(`Failed to check project Git status: ${err}`);
    } finally {
      setCreating(false);
    }
  };

  const handleOpen = async () => {
    const p = folderPath.trim();
    if (!p) return;
    await preflightProjectInitialization({ mode: "open", path: p });
  };

  const handleCreate = async () => {
    const p = folderPath.trim();
    if (!p) return;
    const name = newName.trim() || undefined;
    await preflightProjectInitialization({ mode: "create", path: p, ...(name ? { name } : {}) });
  };

  const handleRemoveRecent = async (id: string) => {
    setProjectToRemove(null);
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      log.error("project_remove_failed", { error: err });
    }
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
            <p>Open a folder to resume your canvas, or create a new project.</p>
          </div>
        </header>

        {!loading && projects.length === 0 && <ProjectsTutorial prominent />}

        <section className="project-list-card" aria-labelledby="project-action-title">
          <div className="project-list-card__heading">
            <span className="project-list-card__icon" aria-hidden="true">
              {mode === "open" ? <FolderOpen size={15} /> : <Plus size={15} />}
            </span>
            <div>
              <h2 id="project-action-title">
                {mode === "open" ? "Open a workspace" : "Create a workspace"}
              </h2>
              <p>
                {mode === "open"
                  ? "Choose an existing repository to continue where you left off."
                  : "Start a fresh Swarmcrews canvas in a local repository."}
              </p>
            </div>
          </div>

          <div className="project-list-card__body">
            <div className="project-list-mode" role="group" aria-label="Project action">
              <button
                type="button"
                aria-pressed={mode === "open"}
                onClick={() => {
                  setMode("open");
                  setPendingGitDecision(null);
                }}
              >
                <FolderOpen size={13} aria-hidden="true" />
                Open Folder
              </button>
              <button
                type="button"
                aria-pressed={mode === "create"}
                onClick={() => {
                  setMode("create");
                  setPendingGitDecision(null);
                }}
              >
                <Plus size={13} aria-hidden="true" />
                New Project
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
                  setPendingGitDecision(null);
                }}
                onSubmit={() => { if (!projectActionDisabled) void (mode === "open" ? handleOpen() : handleCreate()); }}
              />
              {mode === "create" && (
                <label className="project-list-field">
                  <span>Project name</span>
                  <input
                    type="text"
                    placeholder="Project name (optional, defaults to folder name)"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setPendingGitDecision(null);
                    }}
                  />
                </label>
              )}
              <button
                type="button"
                className="project-list-primary-action"
                onClick={() => void (mode === "open" ? handleOpen() : handleCreate())}
                disabled={projectActionDisabled}
              >
                {creating ? "Opening..." : mode === "open" ? "Open" : "Create"}
                {!creating && <ArrowRight size={14} aria-hidden="true" />}
              </button>
            </div>

            {pendingGitDecision && (
              <ProjectGitWarning
                busy={creating}
                variant="desktop"
                onContinue={() => void finishProjectInitialization(pendingGitDecision, "continue_without_git")}
                onInitialize={() => void finishProjectInitialization(pendingGitDecision, "initialize")}
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
            {loading ? (
              <div className="project-list-state project-list-state--loading">Loading...</div>
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
            onClick: () => void handleRemoveRecent(projectToRemove.id),
          }]}
        />
      )}
    </main>
  );
}
