import { ACTIVE_LEADER_LABELS, projectAgentActivity } from "../shared/project-agent-activity.ts";
import { Brand } from "./components/Brand.tsx";
import { useState, useRef, useEffect, type ReactNode } from "react";
import { Activity, Check, ChevronDown, Folder, FolderKanban, LayoutGrid, Pencil, Search, X } from "lucide-react";
import { CrewIcon } from "./components/CrewIcon.tsx";
import { LeaderStatusIcon } from "./nodes/leader/LeaderStatusIcon.tsx";
import type { SaveStatus } from "./use-autosave.ts";
import { type ProjectSettings, type ProjectSummary } from "./api.ts";
import { SettingsMenu } from "./SettingsMenu.tsx";
import type { SessionInfo, SocketSubscribe } from "./use-socket.ts";
import { sessionBelongsToProject, sessionDisplayTitle } from "./mobile/mobile-selectors.ts";
import type { SettingsSaveState } from "./ContextActionsSettings.tsx";
import "./project-header.css";
import { ProjectRename } from "./project-recovery/ProjectRename.tsx";
import { ProjectSessionActivity } from "./ProjectSessionActivity.tsx";
import type { ProjectActivitySummary } from "../shared/project-activity.ts";

import { getLibrary } from "./project-library/api.ts";
import { asProjectSummary, defaultFilters, selectProjects } from "./project-library/model.ts";

export type ActiveView = "activity" | "canvas";

function ProjectAgentPreview({ project, sessions, summary }: {
  project: ProjectSummary;
  sessions: SessionInfo[];
  summary?: ProjectActivitySummary | undefined;
}) {
  const workspaceId = project.workspaceId ?? project.id;
  const belongsToProject = (session: SessionInfo) =>
    session.projectId
      ? session.projectId === workspaceId
      : sessionBelongsToProject(session, project.sourceRoot ?? project.path, workspaceId);
  const { active, activeCrew: liveCrew } = projectAgentActivity(sessions, belongsToProject);
  const activeLeaders = summary?.activeLeaders ?? active.length;
  const activeCrew = summary?.activeCrew ?? liveCrew;
  if (activeLeaders === 0 && activeCrew === 0) return null;

  const leaderLabel = `${activeLeaders} active leader${activeLeaders === 1 ? "" : "s"}`;

  return (
    <span className="project-switcher__preview">
      <span className="project-switcher__preview-heading">
        <span className="project-switcher__metric">
          <LeaderStatusIcon size={12} active={activeLeaders > 0} decorative />
          {leaderLabel}
        </span>
        <span className="project-switcher__metric" title="Minions currently starting or executing">
          <CrewIcon size={12} aria-hidden="true" />
          {activeCrew} crew
        </span>
      </span>
      {active.slice(0, 3).map((session) => (
        <span className="project-switcher__minion" key={session.sessionKey}
          title={`${sessionDisplayTitle(session)} · ${ACTIVE_LEADER_LABELS[session.status]}`}>
          <span className="project-switcher__minion-dot" data-status={session.status} aria-hidden="true" />
          <span className="project-switcher__minion-name">{sessionDisplayTitle(session)}</span>
          <span className="project-switcher__minion-status">{ACTIVE_LEADER_LABELS[session.status]}</span>
        </span>
      ))}
      {active.length > 3 ? (
        <span className="project-switcher__preview-more">+{active.length - 3} more</span>
      ) : null}
    </span>
  );
}

interface ProjectHeaderProps {
  projectId: string;
  name: string;
  saveStatus: SaveStatus;
  lastSaved: Date | null;
  onRename: (name: string) => void | Promise<void>;
  onBack: () => void;
  onSwitchProject: (id: string, path: string) => void;
  /** Live sessions scoped to the current project, including delegated minions. */
  sessions?: SessionInfo[];
  retryCount?: number;
  retry?: () => void;
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  /**
   * Number of sessions needing attention (includes sessions with pending
   * worktree changes) — shows a badge on the Activity tab.
   */
  activityAttentionCount?: number;
  settings: ProjectSettings;
  onSettingsChange: (settings: ProjectSettings) => void;
  settingsSaveState?: SettingsSaveState;
  onRetrySettingsSave?: () => void;
  socketSend?: (data: unknown) => void;
  socketSubscribe?: SocketSubscribe;
  actions?: ReactNode;
}

export function ProjectHeader({
  projectId,
  name,
  saveStatus,
  lastSaved,
  onRename,
  onBack,
  onSwitchProject,
  sessions = [],
  retryCount = 0,
  retry,
  activeView,
  onViewChange,
  activityAttentionCount = 0,
  settings,
  onSettingsChange,
  settingsSaveState,
  onRetrySettingsSave,
  socketSend,
  socketSubscribe,
  actions,
}: ProjectHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [search, setSearch] = useState("");
  const [projectListVersion, setProjectListVersion] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const [projectTags, setProjectTags] = useState<Record<string, string[]>>({});
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState(false);
  const [activity, setActivity] = useState<ProjectActivitySummary[]>([]);
  const activityByProject = new Map(activity.map((summary) => [summary.projectId, summary]));
  const switcherRef = useRef<HTMLDivElement>(null);
  const switcherButtonRef = useRef<HTMLButtonElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const filteredProjects = projects.filter(project =>
    [project.id === projectId ? name : project.name, project.path, ...(projectTags[project.id] ?? [])]
      .some(value => value.toLocaleLowerCase().includes(query)));

  useEffect(() => {
    const jump = (e: KeyboardEvent) => {
      if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!switcherOpen) setProjectsLoading(true);
        setSwitcherOpen(true);
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", jump); return () => window.removeEventListener("keydown", jump);
  }, [editing, switcherOpen]);

  useEffect(() => {
    if (!editing) switcherButtonRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!switcherOpen) {
      setSearch("");
      return;
    }

    let cancelled = false;
    searchRef.current?.focus();
    setProjectsLoading(true);
    setProjectsError(false);
    void getLibrary()
      .then((library) => {
        if (!cancelled) {
          // Quick switching follows recency, independently of the library's Focus order.
          setProjects(selectProjects(library, defaultFilters).map(asProjectSummary));
          setProjectTags(Object.fromEntries(library.projects.map(p => [p.id, p.tags])));
        }
      })
      .catch(() => {
        if (!cancelled) setProjectsError(true);
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [switcherOpen, projectListVersion]);

  useEffect(() => {
    if (!switcherOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSwitcherOpen(false);
      switcherButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [switcherOpen]);

  const statusLabel = () => {
    switch (saveStatus) {
      case "saving":
        return retryCount > 0 ? `Retrying... (attempt ${retryCount + 1})` : "Saving...";
      case "saved":
        if (lastSaved) {
          const secs = Math.floor(
            (Date.now() - lastSaved.getTime()) / 1000,
          );
          if (secs < 5) return "Saved";
          if (secs < 60) return `Saved ${secs}s ago`;
          return `Saved ${Math.floor(secs / 60)}m ago`;
        }
        return "Saved";
      case "unsaved":
        return "Unsaved";
      case "error":
        return "Save failed \u00b7 Click to retry";
      case "idle":
        return "";
    }
  };

  const statusColor = () => {
    switch (saveStatus) {
      case "saving":
        return "var(--text-muted)";
      case "saved":
        return "var(--success-color)";
      case "unsaved":
        return "var(--accent)";
      case "error":
        return "var(--danger-color)";
      case "idle":
        return "var(--text-muted)";
    }
  };

  return (
    <div
      className="project-header"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 44,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-default)",
        // Keep header menus above canvas overlays (850–900), below dialogs (1000+).
        zIndex: 950,
        gap: 12,
      }}
    >
      <button
        type="button"
        className="project-header-logo"
        onClick={onBack}
        aria-label="All projects"
        title="All projects"
      >
        <Brand decorative />
      </button>

      <div className="project-switcher" ref={switcherRef}>
        <button
          ref={switcherButtonRef}
          type="button"
          className="project-switcher__trigger"
          disabled={editing}
          aria-label={name}
          title={name}
          aria-haspopup="menu"
          aria-expanded={switcherOpen}
          onClick={() => {
            // Gate the counts request until this opening's project list has loaded.
            if (!switcherOpen) setProjectsLoading(true);
            setSwitcherOpen((open) => !open);
          }}
        >
          <span className="project-switcher__copy">
            <span className="project-switcher__name">{name}</span>
          </span>
          <ChevronDown
            className="project-switcher__chevron"
            data-open={switcherOpen || undefined}
            size={14}
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </button>

        {switcherOpen ? (
          <div className="project-switcher__menu" role="menu" aria-label="Switch project"
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              const menu = event.currentTarget;
              const inSearch = event.target === searchRef.current;
              if (inSearch && event.key === "Enter") {
                event.preventDefault();
                menu.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.click();
                return;
              }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              // Home/End retain normal text-editing behavior in search.
              if (inSearch && (event.key === "Home" || event.key === "End")) return;
              const items = Array.from(menu.querySelectorAll<HTMLElement>('input, [role="menuitemradio"], [role="menuitem"]'));
              const index = items.indexOf(document.activeElement as HTMLElement);
              const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
              event.preventDefault();
              items[next]?.focus();
            }}>
            {!projectsLoading && !projectsError && <ProjectSessionActivity
              projectIds={projects.filter((project) => project.id !== projectId)
                .map((project) => project.workspaceId ?? project.id)}
              onSummaryChange={setActivity}
            />}
            <div className="project-switcher__label">Recent projects</div>
            <div className="project-switcher__search">
              <Search size={15} aria-hidden="true" />
              <input ref={searchRef} type="search" aria-label="Search projects"
                placeholder="Search by name, path, or tag…" value={search}
                onChange={event => setSearch(event.target.value)} />
              {search && <button type="button" aria-label="Clear search" onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}><X size={14} aria-hidden="true" /></button>}
            </div>
            <div className="project-switcher__list">
              {projectsLoading && projects.length === 0 ? (
                <div className="project-switcher__state" role="status">Loading projects…</div>
              ) : null}
              {projectsError ? (
                <div className="project-switcher__state" role="alert">
                  Couldn’t load projects
                  <button className="project-switcher__retry" type="button" onClick={() => setProjectListVersion(value => value + 1)}>Retry project list</button>
                </div>
              ) : null}
              {!projectsLoading && !projectsError && projects.length === 0 ? (
                <div className="project-switcher__state">No projects available</div>
              ) : null}
              {!projectsLoading && !projectsError && projects.length > 0 && filteredProjects.length === 0 && (
                <div className="project-switcher__state" role="status">No matching projects</div>
              )}
              {filteredProjects.map((project) => {
                const current = project.id === projectId;
                return (
                  <button
                    key={project.id}
                    type="button"
                    className="project-switcher__project"
                    role="menuitemradio"
                    aria-checked={current}
                    title={project.path}
                    onClick={() => {
                      setSwitcherOpen(false);
                      switcherButtonRef.current?.focus();
                      if (!current) onSwitchProject(project.id, project.path);
                    }}
                  >
                    <span className="project-switcher__project-icon" aria-hidden="true">
                      <Folder size={16} strokeWidth={1.75} />
                    </span>
                    <span className="project-switcher__project-copy">
                      <span className="project-switcher__project-name">
                        {current ? name : project.name}
                      </span>
                      <span className="project-switcher__project-path">{project.path}</span>
                      <ProjectAgentPreview project={project} sessions={current ? sessions : []}
                        summary={current ? undefined : activityByProject.get(project.workspaceId ?? project.id)} />
                    </span>
                    <span className="project-switcher__project-check" aria-hidden="true">
                      {current ? <Check size={14} strokeWidth={2} /> : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="project-switcher__actions">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSwitcherOpen(false);
                  setEditing(true);
                }}
              >
                <Pencil size={13} aria-hidden="true" />
                Rename project
              </button>
              <button type="button" role="menuitem" onClick={onBack}>
                <FolderKanban size={13} aria-hidden="true" />
                View all projects
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {editing && <ProjectRename name={name} onRename={onRename} onClose={() => {
        setEditing(false);
      }} />}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--bg-primary)",
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          padding: 2,
          gap: 2,
        }}
        role="tablist"
        aria-label="View mode"
      >
        <ViewTab
          label="Activity"
          active={activeView === "activity"}
          onClick={() => onViewChange("activity")}
          badge={activityAttentionCount > 0 ? activityAttentionCount : undefined}
          icon={<Activity size={12} strokeWidth={1.75} aria-hidden />}
        />
        <ViewTab
          label="Canvas"
          active={activeView === "canvas"}
          onClick={() => onViewChange("canvas")}
          icon={<LayoutGrid size={12} strokeWidth={1.75} aria-hidden />}
        />
      </div>

      <div
        onClick={saveStatus === "error" && retry ? () => retry() : undefined}
        className="project-header-save-status"
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 6,
          cursor: saveStatus === "error" && retry ? "pointer" : "default",
          background:
            saveStatus === "error"
              ? "var(--danger-bg)"
              : "transparent",
          border:
            saveStatus === "error"
              ? "1px solid var(--danger-color)"
              : "1px solid transparent",
          transition: "background 0.2s, border-color 0.2s",
        }}
      >
        {saveStatus !== "idle" && (
          <>
            <div
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: statusColor(),
                boxShadow:
                  saveStatus === "saved"
                    ? `0 0 4px ${statusColor()}`
                    : "none",
              }}
            />
            <span
              style={{
                fontSize: 11,
                color: statusColor(),
                fontFamily: "var(--font-mono)",
                letterSpacing: 0.5,
                userSelect: "none",
              }}
            >
              {statusLabel()}
            </span>
          </>
        )}
      </div>

      {actions}
      <SettingsMenu
        settings={settings}
        onSettingsChange={onSettingsChange}
        settingsSaveState={settingsSaveState}
        onRetrySettingsSave={onRetrySettingsSave}
        socketSend={socketSend}
        socketSubscribe={socketSubscribe}
      />
    </div>
  );
}

// ─── View Tab ───────────────────────────────────────────────

function ViewTab({
  label,
  active,
  onClick,
  icon,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  badge?: number | undefined;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 12px",
        fontSize: 11,
        fontFamily: "var(--font-sans)",
        fontWeight: active ? 600 : 500,
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        background: active ? "var(--bg-elevated)" : "transparent",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        transition: "background 120ms ease, color 120ms ease",
        position: "relative",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--bg-surface)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span
          style={{
            minWidth: 16,
            height: 16,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 5px",
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            color: "var(--text-on-status)",
            background: "var(--danger-color)",
            borderRadius: 8,
            lineHeight: 1,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
