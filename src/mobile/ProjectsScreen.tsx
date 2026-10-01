import { useEffect, useMemo, useState } from "react";
import { useProjectList } from "../use-project-list.ts";

import {
  checkProjectGit,
  createProject,
  getHarnessReadiness,
  type HarnessReadinessSnapshot,
  type ProjectGitAction,
  type ProjectSummary,
} from "../api.ts";
import { ProjectSessionActivity } from "../ProjectSessionActivity.tsx";
import type { ProjectActivitySummary } from "../../shared/project-activity.ts";
import { ProjectGitWarning } from "../ProjectGitWarning.tsx";
import { ProjectsTutorial } from "../ProjectsTutorial.tsx";
import { RepositoryPathPicker } from "../components/RepositoryPathPicker.tsx";

interface ProjectsScreenProps {
  onSelectProject: (project: ProjectSummary) => void;
}

export function ProjectsScreen({ onSelectProject }: ProjectsScreenProps) {
  const [activity, setActivity] = useState<ProjectActivitySummary[]>([]);
  const { projects, loading, error } = useProjectList();
  const [projectPath, setProjectPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<HarnessReadinessSnapshot | null>(null);
  const [pendingGitDecision, setPendingGitDecision] = useState<{ name: string; path: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getHarnessReadiness().then((value) => { if (!cancelled) setReadiness(value); });

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => new Map(activity.map(summary => [summary.projectId, summary])), [activity]);

  function closeCreateForm() {
    if (creating) return;
    setShowCreateForm(false);
    setProjectPath("");
    setProjectName("");
    setCreateError(null);
    setPendingGitDecision(null);
  }

  async function finishCreateProject(
    project: { name: string; path: string },
    gitAction?: ProjectGitAction,
  ) {
    setCreating(true);
    setCreateError(null);
    try {
      const created = gitAction
        ? await createProject(project.name, project.path, gitAction)
        : await createProject(project.name, project.path);
      onSelectProject({
        id: created.id,
        path: created.path,
        name: created.name,
        lastOpened: created.updatedAt,
        hasSidecar: true,
      });
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPath = projectPath.trim();
    if (!trimmedPath || creating) return;

    const project = { name: projectName.trim() || "Untitled", path: trimmedPath };
    setCreating(true);
    setCreateError(null);
    setPendingGitDecision(null);
    try {
      const status = await checkProjectGit(project.path);
      if (!status.isRepository) {
        setPendingGitDecision(project);
        return;
      }
      await finishCreateProject(project);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to check project Git status");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mob-screen mob-projects" aria-label="Projects">
      <header className="mob-screen-header">
        <h1>Projects</h1>
        <div className="mob-project-header-actions">
          {!loading && projects.length > 0 && <ProjectsTutorial />}
          {projects.length > 0 ? <span className="mob-count">{projects.length}</span> : null}
          <button
            type="button"
            className="mob-header-action"
            onClick={() => {
              setShowCreateForm(true);
              setCreateError(null);
            }}
            aria-expanded={showCreateForm}
          >
            Add repository
          </button>
        </div>
      </header>

      {!loading && !error && projects.length === 0 && <ProjectsTutorial prominent />}

      {showCreateForm ? (
        <form className="mob-project-create" onSubmit={handleCreateProject}>
          <div className="mob-project-create-intro">
            <h2>Register a repository</h2>
            <p>A project connects Swarmcrews to one repository. Canvas workspaces, such as Global, organize work inside it.</p>
          </div>
          <div className="mob-muted">{readiness?.harnesses.map((h) => `${h.name}: ${h.ready ? "Ready" : h.state.replaceAll("_", " ")}`).join(" · ")}</div>
          <RepositoryPathPicker
            value={projectPath}
            disabled={creating}
            placeholder="/path/to/new/project"
            autoFocus
            onChange={(path) => {
              setProjectPath(path);
              setPendingGitDecision(null);
            }}
          />
          <label className="mob-launch-field">
            <span>Name</span>
            <input
              type="text"
              value={projectName}
              onChange={(event) => {
                setProjectName(event.currentTarget.value);
                setPendingGitDecision(null);
              }}
              placeholder="Untitled"
            />
          </label>
          {pendingGitDecision ? (
            <ProjectGitWarning
              busy={creating}
              variant="mobile"
              onContinue={() => void finishCreateProject(pendingGitDecision, "continue_without_git")}
              onInitialize={() => void finishCreateProject(pendingGitDecision, "initialize")}
            />
          ) : null}
          {createError ? <div className="mob-launch-error" role="alert">{createError}</div> : null}
          <div className="mob-project-create-actions">
            <button className="mob-header-action" type="button" onClick={closeCreateForm}>
              Cancel
            </button>
            <button
              className="mob-launch-submit"
              type="submit"
              disabled={creating || !projectPath.trim() || readiness?.ready === false || pendingGitDecision !== null}
            >
              {creating ? "Registering..." : "Register project"}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? <div className="mob-launch-status">Loading projects...</div> : null}
      {error ? <div className="mob-launch-error" role="alert">{error}</div> : null}
      {!loading && !error && projects.length === 0 ? (
        <div className="mob-empty mob-empty--surface">
          <h2>Start with a project</h2>
          <p><span>No recent projects found.</span> Create one to launch and monitor Leaders from your phone.</p>
        </div>
      ) : null}

      <ProjectSessionActivity projectIds={projects.map(project => project.id)} onSummaryChange={setActivity} />
      <div className="mob-project-list">
        {projects.map((project) => {
          const stat = stats.get(project.id);
          return (
            <button
              className="mob-project-card"
              key={project.id}
              type="button"
              onClick={() => onSelectProject(project)}
            >
              <span className="mob-project-name">{project.name}</span>
              <span className="mob-project-path">{project.path}</span>
              <span className="mob-project-meta">
                {stat ? `${stat.activeLeaders} active ${stat.activeLeaders === 1 ? "Leader" : "Leaders"} · ${stat.activeCrew} active crew` : "Checking activity…"}
              </span>
            </button>
          );
        })}
      </div>
    </main>
  );
}
