import { NavigationDraft } from "../navigation-drafts.tsx";
import { useEffect, useState } from "react";
import { useRegistrationOpen } from "../project-library/use-registration-open.ts";
import { LibraryWorkspace } from "../project-library/LibraryWorkspace.tsx";
import { LibraryNotice } from "../project-library/LibraryNotice.tsx";
import { asProjectSummary, rememberDestination, type ProjectDestination } from "../project-library/model.ts";

import {
  checkProjectGit,
  createProject,
  getHarnessReadiness,
  type HarnessReadinessSnapshot,
  type ProjectGitAction,
  type ProjectSummary,
} from "../api.ts";
import { ProjectGitWarning } from "../ProjectGitWarning.tsx";
import { RepositoryPathPicker } from "../components/RepositoryPathPicker.tsx";

interface ProjectsScreenProps {
  onSelectProject: (project: ProjectSummary, destination?: ProjectDestination) => void;
}

export function ProjectsScreen({ onSelectProject }: ProjectsScreenProps) {
  const registration = useRegistrationOpen((id, path, _acknowledgement, registered) => onSelectProject(registered ?? { id, path, name:"Untitled", lastOpened:new Date().toISOString(), hasSidecar:true }));
  const [projectPath, setProjectPath] = useState("");
  const [choosingFolder, setChoosingFolder] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [completed, setCompleted] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<ProjectSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<HarnessReadinessSnapshot | null>(null);
  const [pendingGitDecision, setPendingGitDecision] = useState<{ name: string; path: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getHarnessReadiness().then((value) => { if (!cancelled) setReadiness(value); }).catch(() => { /* Optional probe cannot hide Library. */ });

    return () => {
      cancelled = true;
    };
  }, []);


  useEffect(() => {
    if (!pendingOpen) return;
    setPendingOpen(null); registration.open(pendingOpen.id, pendingOpen.path, undefined, pendingOpen);
  }, [pendingOpen, registration.open]);

  function closeCreateForm() {
    if (creating) return;
    setShowCreateForm(false);
    setProjectPath("");
    setChoosingFolder(true);
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
      setCompleted(true); setPendingOpen({ id:created.id, path:created.path, name:created.name, lastOpened:created.updatedAt, hasSidecar:true });
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPath = projectPath.trim();
    if (choosingFolder || !trimmedPath || creating) return;

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
      {registration.notice && <LibraryNotice tone="warning" alert onDismiss={registration.dismiss}>{registration.notice}</LibraryNotice>}
      <LibraryWorkspace compact actions={() => <button type="button" className="mob-header-action" onClick={() => setShowCreateForm(true)} aria-expanded={showCreateForm}>Add repository</button>}
        onOpen={(project, destination) => { rememberDestination(project.id, destination); onSelectProject(asProjectSummary(project), destination); }}
        registration={() => showCreateForm ? (
        <form className="mob-project-create" onSubmit={handleCreateProject}>
          <NavigationDraft scope="mobile-registration" dirty={!completed && (!!projectPath || !!projectName)} pending={!completed && creating} />
          <div className="mob-project-create-intro">
            <h2>Register a repository</h2>
            <p>A project connects Swarmcrews to one repository. Canvas workspaces, such as Global, organize work inside it.</p>
          </div>
          <div className="mob-muted">{readiness?.harnesses.map((h) => `${h.name}: ${h.ready ? "Ready" : h.state.replaceAll("_", " ")}`).join(" · ")}</div>
          {readiness?.ready === false && <div role="alert">Sign in to Claude or Codex to register a project.<button type="button" onClick={() => void getHarnessReadiness(true).then(setReadiness).catch(err => setCreateError(String(err)))}>Check again</button></div>}
          <RepositoryPathPicker
            value={projectPath}
            disabled={creating}
            placeholder="/path/to/new/project"
            autoFocus
            onChange={(path) => {
              setCompleted(false); setProjectPath(path);
              setPendingGitDecision(null);
            }}
            onEditingChange={setChoosingFolder}
          />
          <label className="mob-launch-field">
            <span>Name</span>
            <input
              type="text"
              value={projectName}
              onChange={(event) => {
                setCompleted(false); setProjectName(event.currentTarget.value);
                setPendingGitDecision(null);
              }}
              placeholder="Untitled"
            />
          </label>
          {pendingGitDecision && !choosingFolder ? (
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
              Cancel registration
            </button>
            <button
              className="mob-launch-submit"
              type="submit"
              disabled={creating || choosingFolder || !projectPath.trim() || readiness?.ready === false || pendingGitDecision !== null}
            >
              {creating ? "Registering..." : "Register project"}
            </button>
          </div>
        </form>
        ) : null} />
    </main>
  );
}
