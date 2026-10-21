import { hasNavigationDraft, openNavigationDraft } from "../navigation-drafts.tsx";
import { projectDestination, rememberDestination, type ProjectDestination } from "../project-library/model.ts";
import { getLibrary } from "../project-library/api.ts";
import { ContextReader } from "../project-library/ContextReader.tsx";
import { DraftNavigationDialog } from "../project-library/DraftNavigationDialog.tsx";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Bell, BellRing, ChevronLeft, Plus, Settings } from "lucide-react";

import { type ProjectSummary } from "../api.ts";
import { useSocket } from "../use-socket.ts";
import { HarnessListProvider } from "../use-harness-list.tsx";
import { useSessionActivity } from "../use-session-activity.ts";
import { mergeCanonicalActivity, useWorkItems } from "../use-work-items.ts";
import { ActivityScreen, type ActivityViewMemory } from "./ActivityScreen.tsx";
import type { ActivityNotice } from "./ActivityScreen.tsx";
import { LaunchScreen } from "./LaunchScreen.tsx";
import { ProjectsScreen } from "./ProjectsScreen.tsx";
import { ReviewChangesScreen } from "./ReviewChangesScreen.tsx";
import { SettingsScreen } from "./SettingsScreen.tsx";
import { SessionChatScreen, type SessionViewMemory } from "./SessionChatScreen.tsx";
import {
  pendingApprovalsList,
  reduceApprovalMessage,
  type PendingApprovalsMap,
} from "./mobile-approvals.ts";
import { sessionDisplayTitle, sessionBelongsToProject } from "./mobile-selectors.ts";
import {
  disablePush,
  enablePush,
  getPushState,
  isPushSupported,
  registerServiceWorker,
} from "./push.ts";
import { useMobileKeyboard } from "./use-mobile-keyboard.ts";
import { buildWsUrl } from "../ws-url.ts";
import { MobileThemeProvider } from "./MobileThemeProvider.tsx";
import "./mobile.css";

import { mobileRouteFromUrl, useMobileNavigation, type ProjectScope } from "./use-mobile-navigation.ts";

type PushUiState = "loading" | "subscribed" | "default" | "denied" | "unsupported" | "error";

interface PushNavigateMessage {
  type: "push-navigate";
  url: string;
}

function isPushNavigateMessage(value: unknown): value is PushNavigateMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "push-navigate" &&
    "url" in value &&
    typeof value.url === "string"
  );
}

function NotificationsButton({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushUiState>("loading");
  const [busy, setBusy] = useState(false);

  const refreshState = useCallback(() => {
    if (!isPushSupported()) {
      setState("unsupported");
      return;
    }

    void getPushState()
      .then(setState)
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  const label = useMemo(() => {
    if (busy) return "Notifications...";
    switch (state) {
      case "subscribed":
        return "Notifications On";
      case "denied":
        return "Notifications Blocked";
      case "unsupported":
        return "Notifications Unsupported";
      case "error":
        return "Notifications Error";
      case "loading":
        return "Notifications...";
      case "default":
        return "Enable notifications";
    }
  }, [busy, state]);

  const disabled = busy || state === "loading" || state === "denied" || state === "unsupported";

  const handleClick = useCallback(() => {
    if (disabled) return;

    setBusy(true);
    const action = state === "subscribed" ? disablePush() : enablePush();
    void action
      .then((result) => {
        if (result === "unsupported") {
          setState("unsupported");
          return;
        }
        if (result === "denied") {
          setState("denied");
          return;
        }
        refreshState();
      })
      .catch(() => setState("error"))
      .finally(() => setBusy(false));
  }, [disabled, refreshState, state]);

  return (
    <button
      type="button"
      className="mob-notifications-button"
      disabled={disabled}
      onClick={handleClick}
      aria-label={state === "subscribed" ? "Disable notifications" : "Enable notifications"}
      title={label}
    >
      {compact ? (state === "subscribed" ? <BellRing size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />) : label}
    </button>
  );
}

function MobileHeader({ connected, reconnectState, selectedProject, activeTab, onBack,
  onReconnect, onSettings, onNew }: {
  connected: boolean; reconnectState: string; selectedProject: ProjectScope | null;
  activeTab: string; onBack: () => void; onReconnect: () => void;
  onSettings: () => void; onNew: () => void;
}) {
  const atHome = activeTab === "activity";
  return <header className="mob-app-header">
    <div className="mob-app-header-main">
      {selectedProject ? <button type="button" className="mob-header-back" onClick={onBack}
        aria-label={atHome ? "Back to projects" : "Back to activity"}>
        <ChevronLeft size={20} aria-hidden="true" />
      </button> : null}
      <div className="mob-app-title">
        <span>{selectedProject ? atHome ? "Project" : activeTab === "launch" ? "New task" : "Settings" : "Projects"}</span>
        <strong title={selectedProject?.path}>{selectedProject?.name ?? "Swarmcrews"}</strong>
      </div>
    </div>
    <div className="mob-app-header-actions">
      <span className="mob-connection-dot" data-state={reconnectState} role="status"
        aria-label={connected ? "Connected" : reconnectState} title={connected ? "Connected" : reconnectState} />
      {reconnectState === "failed" ? <button type="button" className="mob-header-action" onClick={onReconnect}>Reconnect</button> : <NotificationsButton compact />}
      {selectedProject && atHome ? <>
        <button type="button" className="mob-header-action" onClick={onSettings} aria-label="Settings"><Settings size={18} aria-hidden="true" /></button>
        <button type="button" className="mob-header-action mob-primary-action" onClick={onNew} aria-label="New"><Plus size={18} aria-hidden="true" /></button>
      </> : null}
    </div>
  </header>;
}

export default function MobileApp() {

  const { connected, send, subscribe, reconnectState, manualReconnect } = useSocket(buildWsUrl());
  const keyboard = useMobileKeyboard();
  const { route, navigate, backToActivity: openActivity, closeGraph } = useMobileNavigation();
  const { project: selectedProject, sessionKey: routedSessionKey, screen: activeTab } = route;
  const { sessions, mobileSessions, hasLoaded: sessionsLoaded } = useSessionActivity(subscribe, {
    projectId: selectedProject?.id ?? null, connected, send,
  });
  const activityMemories = useRef(new Map<string, ActivityViewMemory>());
  const sessionMemories = useRef(new Map<string, SessionViewMemory>());
  const sessionWorkItems = useRef(new Map<string, string>());
  const [lastSessionKey, setLastSessionKey] = useState<string | null>(null);
  const workItemState = useWorkItems({ projectId: selectedProject?.id ?? null,
    connected, subscribe, send });
  const canonicalSessions = useMemo(
    () => mergeCanonicalActivity(mobileSessions, workItemState.orderedItems,
      workItemState.coordination),
    [mobileSessions, workItemState.orderedItems, workItemState.coordination],
  );
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalsMap>({});
  const [pendingLaunchSessionKey, setPendingLaunchSessionKey] = useState<string | null>(null);
  const [activityNotice, setActivityNotice] = useState<ActivityNotice | null>(null);

  useEffect(() => {
    return subscribe("*", (msg) => {
      setPendingApprovals((current) => reduceApprovalMessage(current, msg));
    });
  }, [subscribe]);


  // Activity replaces a work item's row when its primary iteration changes.
  // Retain observed identities so an open chat (or Back entry) can follow that
  // row even after the old run disappears from the server's session list.
  useLayoutEffect(() => {
    for (const session of [...mobileSessions, ...canonicalSessions]) {
      if (session.workItemId && session.role === "leader" && session.runKind !== "child") {
        sessionWorkItems.current.set(session.sessionKey, session.workItemId);
      }
    }
  }, [mobileSessions, canonicalSessions]);
  const routedSession = mobileSessions.find((session) => session.sessionKey === routedSessionKey);
  const routedWorkItemId = routedSession?.role === "leader" && routedSession.runKind !== "child"
    ? routedSession.workItemId ?? sessionWorkItems.current.get(routedSessionKey!)
    : routedSessionKey ? sessionWorkItems.current.get(routedSessionKey) : undefined;
  const selectedSession = canonicalSessions.find((session) => session.sessionKey === routedSessionKey)
    ?? (routedWorkItemId ? canonicalSessions.find((session) => session.workItemId === routedWorkItemId) : undefined);
  const selectedSessionKey = selectedSession?.sessionKey ?? routedSessionKey;
  useLayoutEffect(() => {
    if (activeTab !== "chat" || !selectedSessionKey || selectedSessionKey === routedSessionKey) return;
    setLastSessionKey(selectedSessionKey);
    // Replace the expired run's URL; submitting an iteration is not a new
    // navigation step, and Back should still return to the prior screen.
    navigate({ ...route, sessionKey: selectedSessionKey }, true);
  }, [activeTab, selectedSessionKey, routedSessionKey, navigate, route]);

  // Once a project is chosen, every list screen is scoped to it. Sessions are
  // matched by stable workspace identity plus source/worktree location (see
  // sessionBelongsToProject), keeping centrally isolated leaders grouped with
  // their originating project.
  const scopedSessions = useMemo(
    () =>
      selectedProject
        ? canonicalSessions.filter((session) =>
            sessionBelongsToProject(session, selectedProject.path, selectedProject.id),
          )
        : canonicalSessions,
    [canonicalSessions, selectedProject],
  );

  const approvalRows = useMemo(
    () => pendingApprovalsList(pendingApprovals, sessions),
    [pendingApprovals, sessions],
  );
  const scopedApprovalRows = useMemo(() => {
    if (!selectedProject) return approvalRows;
    const scopedKeys = new Set(scopedSessions.map((session) => session.sessionKey));
    return approvalRows.filter((approval) => scopedKeys.has(approval.sessionKey));
  }, [approvalRows, scopedSessions, selectedProject]);
  const sessionToStopForLimit = useMemo(
    () =>
      scopedSessions.find((session) =>
        session.role !== "minion" &&
        session.status !== "stopped" &&
        (session.status === "idle" ||
          session.status === "error" ||
          session.status === "completed")
      ) ??
      scopedSessions.find((session) =>
        session.role !== "minion" && session.status !== "stopped"
      ) ??
      null,
    [scopedSessions],
  );

  const [libraryDestination, setLibraryDestination] = useState<{ projectId: string; workItemId: string } | null>(null);
  const [contextProject, setContextProject] = useState<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const discardingDraft = useRef(false);
  const launchDraftRoot = useRef<HTMLDivElement>(null);
  const [launchHasDraft, setLaunchHasDraft] = useState(false);
  const navigationUrl = useRef(window.location.href);
  useLayoutEffect(() => { navigationUrl.current = window.location.href; discardingDraft.current = false; }, [route]);
  // SessionChatScreen persists prompt/attachments in per-session memory before
  // unmount; allow native same-app navigation without discarding those drafts.
  const activeTabRef = useRef(activeTab); activeTabRef.current = activeTab;
  const draftPresent = () => activeTabRef.current !== "chat" && hasNavigationDraft(document);
  const requestNavigation = useCallback((proceed: () => void) => {
    if (draftPresent()) setPendingNavigation(() => proceed);
    else proceed();
  }, []);
  const confirmNavigation = () => {
    const proceed = pendingNavigation;
    setPendingNavigation(null); setLaunchHasDraft(false); discardingDraft.current = true;
    proceed?.();
  };
  useEffect(() => {
    if (!libraryDestination || selectedProject?.id !== libraryDestination.projectId || workItemState.loading || activeTab !== "activity") return;
    const item = workItemState.items[libraryDestination.workItemId];
    const session = !workItemState.loadError && item?.projectId === selectedProject.id
      ? canonicalSessions.find(s => s.canonicalWorkItem && s.workItemId === item.id
        && s.sessionKey === (item.currentRunKey ?? `work-item:${item.id}`)) : undefined;
    if (session) {
      setActivityNotice(null); setLibraryDestination(null);
      navigate({ ...route, screen: "chat", sessionKey: session.sessionKey, view: "work" });
    } else setActivityNotice({ title: "Work item unavailable", message: "The requested work item could not be resolved from current project records. Project Activity is shown; another run was not substituted.",
      actionLabel: "Retry requested work item", onAction: workItemState.retryLoad,
      onDismiss: () => { setLibraryDestination(null); setActivityNotice(null); } });
  }, [libraryDestination, selectedProject, activeTab, workItemState.loading, workItemState.items, workItemState.loadError, workItemState.retryLoad, canonicalSessions, navigate, route]);
  useEffect(() => {
    if (selectedProject && activeTab === "chat" && selectedSession?.workItemId) rememberDestination(selectedProject.id, { view:"activity", workItemId:selectedSession.workItemId });
  }, [selectedProject, activeTab, selectedSession?.workItemId]);

  const selectedApproval = approvalRows.find((approval) => approval.sessionKey === selectedSessionKey);
  const selectProject = useCallback((project: ProjectSummary, requested?: ProjectDestination) => requestNavigation(() => {
    const destination = requested ?? projectDestination(project.id);
    if (destination.view === "canvas") {
      const url = new URL("/", window.location.origin); url.searchParams.set("view", "desktop"); url.searchParams.set("project", project.id); url.searchParams.set("surface", "canvas"); window.location.assign(url.href); return;
    }
    if (destination.view === "context") setContextProject(project.id);
    setLibraryDestination(destination.workItemId ? { projectId: project.id, workItemId: destination.workItemId } : null);
    navigate({ project: { id: project.id, path: project.path, name: project.name }, screen: "activity", sessionKey: null, view: "chat" });
  }), [navigate, requestNavigation]);
  const backToProjects = useCallback(() => requestNavigation(() => {
    navigate({ project: null, screen: "activity", sessionKey: null, view: "chat" });
  }), [navigate, requestNavigation]);
  const openSession = useCallback((sessionKey: string) => {
    setLibraryDestination(null); setActivityNotice(null);
    setLastSessionKey(sessionKey);
    navigate({ ...route, screen: "chat", sessionKey, view: "chat" });
  }, [navigate, route]);
  const handleLaunchSubmitted = useCallback((sessionKey: string) => {
    setLaunchHasDraft(false);
    setPendingLaunchSessionKey(sessionKey);
    setActivityNotice(null);
    openSession(sessionKey);
  }, [openSession]);
  const openLaunch = useCallback(() => {
    setLibraryDestination(null);
    navigate({ ...route, screen: "launch", sessionKey: null, view: "chat" });
  }, [navigate, route]);
  const openSettings = useCallback(() => {
    navigate({ ...route, screen: "settings", sessionKey: null, view: "chat" });
  }, [navigate, route]);

  const dismissActivityNotice = useCallback(() => {
    setActivityNotice(null);
  }, []);

  const openSessionToStopForLimit = useCallback(() => {
    if (!sessionToStopForLimit) return;
    setActivityNotice(null);
    openSession(sessionToStopForLimit.sessionKey);
  }, [openSession, sessionToStopForLimit]);

  const showSessionLimitNotice = useCallback(() => {
    setPendingLaunchSessionKey(null);
    setLaunchHasDraft(hasNavigationDraft(launchDraftRoot.current));
    navigate({ ...route, screen:"activity", sessionKey:null, view:"chat" }, true);
    const notice: ActivityNotice = {
      title: "Session limit reached",
      message:
        "Swarmcrews already has 50 non-stopped sessions. Open an idle or errored session and tap Stop, or remove old sessions on desktop, then launch again.",
      onDismiss: dismissActivityNotice,
    };
    if (sessionToStopForLimit) {
      notice.actionLabel = "Open session to stop";
      notice.onAction = openSessionToStopForLimit;
    }
    setActivityNotice(notice);
  }, [dismissActivityNotice, openSessionToStopForLimit, sessionToStopForLimit, navigate, route]);

  useEffect(() => {
    return subscribe("*", (msg) => {
      if (msg.type === "session_created" && msg.sessionKey === pendingLaunchSessionKey) {
        setPendingLaunchSessionKey(null);
        return;
      }

      if (
        msg.type !== "session_error" ||
        !/Maximum session limit/i.test(msg.error) ||
        (pendingLaunchSessionKey !== null && msg.sessionKey !== pendingLaunchSessionKey)
      ) {
        return;
      }

      showSessionLimitNotice();
    });
  }, [
    pendingLaunchSessionKey,
    sessionToStopForLimit,
    showSessionLimitNotice,
    subscribe,
  ]);

  const openReview = useCallback((sessionKey: string) => {
    setLibraryDestination(null); setActivityNotice(null);
    setLastSessionKey(sessionKey);
    navigate({ ...route, screen: "chat", sessionKey, view: "changes" });
  }, [navigate, route]);

  const applyMobileUrl = useCallback((url: string) => {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin || !parsed.searchParams.get("session")) return;
    requestNavigation(() => navigate(mobileRouteFromUrl(url)));
  }, [navigate, requestNavigation]);

  // Deep links recover their project from current metadata, including sessions
  // whose worktree lives outside the source repository. Reject stale project IDs.
  const requestedProjectId = new URL(window.location.href).searchParams.get("project");
  useEffect(() => {
    if (selectedProject || (!selectedSession && !requestedProjectId)) return;
    let cancelled = false;
    void getLibrary().then(({ projects }) => {
      if (cancelled) return;
      const project = projects.find((candidate) => !candidate.archived && (selectedSession
        ? sessionBelongsToProject(selectedSession, candidate.path, candidate.id)
        : candidate.id === requestedProjectId));
      if (project) navigate({ ...route, project }, true);
      else if (requestedProjectId) setActivityNotice({ title:"Project unavailable", message:"This project is unavailable or archived. Choose a Library project, or explicitly restore it from Archived." });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedProject, selectedSession, requestedProjectId, navigate, route]);

  useEffect(() => {
    if (!isPushSupported()) return;

    void registerServiceWorker().catch(() => {});
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function handleServiceWorkerMessage(event: MessageEvent<unknown>) {
      if (!isPushNavigateMessage(event.data)) return;
      applyMobileUrl(event.data.url);
    }

    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [applyMobileUrl]);

  useEffect(() => {
    const protect = (e: PopStateEvent) => {
      if (discardingDraft.current || !draftPresent()) return;
      e.stopImmediatePropagation();
      const target = window.location.href; const targetState: unknown = window.history.state;
      setPendingNavigation(() => () => {
        window.history.replaceState(targetState, "", target);
        window.dispatchEvent(new PopStateEvent("popstate", { state: targetState }));
      });
      window.history.replaceState(window.history.state, "", navigationUrl.current);
    };
    window.addEventListener("popstate", protect, true); return () => window.removeEventListener("popstate", protect, true);
  }, [route, selectedProject]);

  const showingActiveSession = activeTab === "chat" && selectedSessionKey !== null;
  const activityKey = selectedProject?.id ?? "projects";
  if (!activityMemories.current.has(activityKey)) activityMemories.current.set(activityKey, {});
  if (selectedSessionKey && !sessionMemories.current.has(selectedSessionKey)) sessionMemories.current.set(selectedSessionKey, {});
  const resumableSession = scopedSessions.find((session) => session.sessionKey === lastSessionKey);
  const activitySessions = scopedSessions.map((session) => scopedApprovalRows.some((approval) => approval.sessionKey === session.sessionKey)
    ? { ...session, pendingAttention: true, reviewableChanges: true } : session);
  const unavailable = sessionsLoaded && !(selectedProject && workItemState.loading) && !selectedSession && pendingLaunchSessionKey !== selectedSessionKey;

  return (
    <MobileThemeProvider>
    {contextProject && <ContextReader projectId={contextProject} onClose={() => setContextProject(null)} />}
    {pendingNavigation && <DraftNavigationDialog onClose={() => setPendingNavigation(null)} onConfirm={confirmNavigation} onOpenDraft={() => {
      setPendingNavigation(null);
      if (hasNavigationDraft(launchDraftRoot.current)) navigate({ ...route, screen:"launch", sessionKey:null, view:"chat" });
      openNavigationDraft();
    }} />}
    <HarnessListProvider send={send} subscribe={subscribe} connected={connected}>
    <div className="mob-app" data-keyboard={keyboard.open ? "open" : "closed"}
      style={{
        "--mob-keyboard-offset": `${keyboard.open ? 0 : keyboard.offset}px`,
        "--mob-viewport-height": `${keyboard.height}px`,
        "--mob-viewport-top": `${keyboard.top}px`,
      } as CSSProperties}>
      {showingActiveSession ? null : <MobileHeader connected={connected} reconnectState={reconnectState}
        selectedProject={selectedProject} activeTab={activeTab}
        onBack={() => activeTab === "activity" ? backToProjects() : requestNavigation(openActivity)}
        onReconnect={manualReconnect} onSettings={() => requestNavigation(openSettings)} onNew={() => requestNavigation(openLaunch)} />}

      {selectedProject && (activeTab === "launch" || launchHasDraft) && <div ref={launchDraftRoot} hidden={activeTab !== "launch"} style={{ flex:1, minHeight:0, display:activeTab === "launch" ? "flex" : "none", flexDirection:"column" }}><LaunchScreen onLaunched={handleLaunchSubmitted} onLaunchError={message => { if (/Maximum session limit/i.test(message)) showSessionLimitNotice(); }} canonicalLaunch={workItemState.launch} lockedProject={selectedProject} /></div>}
      {showingActiveSession ? (
        <SessionChatScreen key={selectedSessionKey} sessionKey={selectedSessionKey}
          session={selectedSession} sessionOptions={scopedSessions}
          runs={selectedSession?.workItemId ? workItemState.runs[selectedSession.workItemId] ?? [] : []}
          runNextCursor={selectedSession?.workItemId ? workItemState.runNextCursor[selectedSession.workItemId] : undefined}
          onLoadRuns={workItemState.loadRuns}
          subscribe={subscribe} send={send} onBack={() => requestNavigation(openActivity)} onSelectSession={key => requestNavigation(() => openSession(key))}
          projectName={selectedProject?.name ?? selectedSession?.cwd?.split("/").filter(Boolean).at(-1)}
          connected={connected} reconnectState={reconnectState} onReconnect={manualReconnect}
          view={route.view} onCloseGraph={closeGraph} onViewChange={view => requestNavigation(() => navigate({ ...route, view }))}
          memory={sessionMemories.current.get(selectedSessionKey)!}
          unavailable={unavailable} loading={!selectedSession && !unavailable}
          changeMode={selectedSession?.workItemId ? workItemState.items[selectedSession.workItemId]?.lifecycle.changeMode : undefined}
          approval={selectedApproval} onOpenReview={() => openReview(selectedSessionKey)}
          changes={selectedSession ? (
            selectedSession.workItemId && !workItemState.items[selectedSession.workItemId] ? (
              <div className="mob-empty" role="status"><h2>Loading change details</h2>
                <p>{workItemState.loadError ?? "Retrieving the current work item."}</p>
                {workItemState.loadError ? <button className="mob-header-action" onClick={workItemState.retryLoad}>Retry</button> : null}
              </div>
            ) : <ReviewChangesScreen embedded approvalPending={Boolean(selectedApproval)} sessionKey={selectedSessionKey}
              workItemId={selectedSession.workItemId ?? null}
              changeMode={selectedSession.workItemId ? workItemState.items[selectedSession.workItemId]?.lifecycle.changeMode : undefined}
              onRequestChanges={(prompt) => {
                const item = selectedSession.workItemId ? workItemState.items[selectedSession.workItemId] : undefined;
                if (!item) return false;
                workItemState.start(item, prompt);
                return true;
              }}
              onClose={() => navigate({ ...route, view: "chat" })}
              send={send} subscribe={subscribe} summary={selectedApproval?.summary}
              title={sessionDisplayTitle(selectedSession)} />
          ) : undefined} />
      ) : !selectedProject ? (
        <ProjectsScreen onSelectProject={selectProject} />
      ) : activeTab === "launch" ? null : activeTab === "settings" ? (
        <SettingsScreen project={selectedProject} socketSend={send} socketSubscribe={subscribe} />
      ) : (
        <ActivityScreen key={activityKey} memory={activityMemories.current.get(activityKey)!}
          resumeSession={resumableSession} onOpenReview={openReview}
          approvalSessionKeys={scopedApprovalRows.map((approval) => approval.sessionKey)}
          loading={!sessionsLoaded || workItemState.loading} loadError={workItemState.loadError}
          onRetryLoad={workItemState.retryLoad} connected={connected} sessions={activitySessions}
          onOpenSession={openSession} onNewLeader={openLaunch} notice={activityNotice} send={send}
          workItemRuns={workItemState.runs} runNextCursor={workItemState.runNextCursor}
          onLoadRuns={workItemState.loadRuns} />
      )}
    </div>
    </HarnessListProvider>
    </MobileThemeProvider>
  );
}
