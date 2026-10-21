import { Archive, Columns3, FolderOpen } from "lucide-react";
import { NavigationDraft } from "../navigation-drafts.tsx";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { librarySummaryFreshness, type LibraryProject } from "../../shared/project-library/index.ts";
import { archiveProject, restoreProject, saveFocus } from "./api.ts";
import { useLibrary, useLibraryActivity, useLibrarySummaries, useLibraryUnread } from "./use-library.ts";
import { focusIds, loadFilters, persistFilters, projectLayout, projectDestination, projectPathHints, recentHighlights, selectProjects, type LibraryFilters, type ProjectDestination } from "./model.ts";
import { ProjectIndexRow, ProjectIndexSkeleton } from "./ProjectIndex.tsx";
import { RecentHighlights } from "./RecentHighlights.tsx";
import { ProjectCard } from "./ProjectCard.tsx";
import { ProjectDetails } from "./ProjectDetails.tsx";
import { ProjectUpdates } from "./ProjectUpdates.tsx";
import { CollectionsDialog } from "./CollectionsDialog.tsx";
import { MissingProjectsDialog } from "./MissingProjectsDialog.tsx";
import { LibraryDialog } from "./LibraryDialog.tsx";
import { MobileLibraryControls } from "./MobileLibraryControls.tsx";
import { LibraryFilterBar } from "./LibraryFilterBar.tsx";
import { LibraryResultsToolbar } from "./LibraryResultsToolbar.tsx";
import { LIBRARY_PAGE_SIZE, LibraryPagination } from "./LibraryPagination.tsx";
import { LibraryHeader } from "./LibraryHeader.tsx";
import { LibrarySort } from "./LibrarySort.tsx";
import { LibraryTools } from "./LibraryTools.tsx";
import { LibraryNotice } from "./LibraryNotice.tsx";
import { DeskActions, DeskStrip } from "./LibraryDesk.tsx";
import { LibraryEmpty, LibrarySkeleton } from "./LibraryStates.tsx";
import { OrganizationActions } from "./OrganizationActions.tsx";
import { UpdatesBar } from "./UpdatesBar.tsx";
import { plural } from "./update-format.ts";
import "./library.css";
const viewCopy = {
  library: ["Project Library", "Every repository you have registered, organized in one place."],
  focus: ["Focus desk", "The few projects you are working on now, in the order you chose."],
  archived: ["Archived projects", "Hidden from Library and Focus. Files and history are preserved; restore any time."],
} as const;
export function LibraryWorkspace({ onOpen, registration, actions, compact = false }: { compact?: boolean; onOpen: (project: LibraryProject, destination: ProjectDestination) => void; registration?: (empty: boolean) => ReactNode; actions?: (empty: boolean) => ReactNode }) {
  const { library, setLibrary, loading, error, reload } = useLibrary();
  const [filters, setFilters] = useState(loadFilters); const [page, setPage] = useState(() => { try { return Math.max(0, Number(sessionStorage.getItem("swarmcrews:library-page")) || 0); } catch { return 0; } });
  const [selected, setSelected] = useState<string | null>(null); const [updates, setUpdates] = useState<string | null>(null);
  const [collectionsOpen, setCollectionsOpen] = useState(false); const [archiveId, setArchiveId] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState<string | null>(null); const [feedback, setFeedback] = useState<string | null>(null);
  const [recoveryNeeded, setRecoveryNeeded] = useState(false);
  // Only authoritative library data clears a failed recovery; panel navigation never does.
  useEffect(() => { if (!error) setRecoveryNeeded(false); }, [library, error]);
  const focusResultsRequested = useRef(false);
  const operationRunning = useRef(false);
  const [version, setVersion] = useState(0); const region = useRef<HTMLElement>(null);
  const activityIds = useMemo(() => filters.view === "library" ? library.projects.filter(p => !p.archived).map(p => p.id) : [], [filters.view, library.projects]);
  const activityFeed = useLibraryActivity(activityIds, version);
  const projects = useMemo(() => selectProjects(library, filters, activityFeed.activity), [library, filters, activityFeed.activity]);
  const visible = projects.slice(page * LIBRARY_PAGE_SIZE, (page + 1) * LIBRARY_PAGE_SIZE);
  const highlights = useMemo(() => filters.view === "library" ? recentHighlights(projects, activityFeed.activity) : [], [filters.view, projects, activityFeed.activity]);
  const pathHints = useMemo(() => projectPathHints(library.projects), [library.projects]);
  const summaries = useLibrarySummaries([...visible.map(p => p.id), ...highlights.map(p => p.id), ...(selected ? [selected] : []), ...(updates ? [updates] : []), ...(archiveId ? [archiveId] : [])], version);
  const unread = useLibraryUnread(version);
  const detailProject = library.projects.find(p => p.id === selected); const updateProject = library.projects.find(p => p.id === updates); const archiveTarget = library.projects.find(p => p.id === archiveId);
  const desk = useMemo(() => focusIds(library), [library]);
  useEffect(() => { persistFilters(filters); }, [filters]);
  useEffect(() => { if (!loading && !error) { try { const top = Number(sessionStorage.getItem("swarmcrews:library-scroll") ?? "0"); const scroll = region.current?.closest(".project-list-page, .mob-projects"); if (scroll) scroll.scrollTop = top; } catch { /* optional */ } } }, [loading, error]);
  useEffect(() => { if (!loading && page > 0 && page * LIBRARY_PAGE_SIZE >= projects.length) setPage(0); }, [projects.length, page, loading]);
  useEffect(() => { try { sessionStorage.setItem("swarmcrews:library-page", String(page)); } catch { /* optional */ } }, [page]);
  useEffect(() => {
    if (!focusResultsRequested.current) return;
    focusResultsRequested.current = false;
    const target = region.current?.querySelector<HTMLElement>(".pl-results-toolbar, .pl-section-heading[tabindex]");
    target?.focus(); target?.scrollIntoView?.({ block: "start" });
  }, [page, library]);
  const goToPage = (next: number) => { focusResultsRequested.current = true; setPage(next); };
  const layout = projectLayout(filters);
  const change = (value: Partial<LibraryFilters>) => { setFilters(prev => ({ ...prev, ...value })); setPage(0); };
  const update = (project: LibraryProject) => { setLibrary(prev => ({ ...prev, projects: prev.projects.map(p => p.id === project.id ? project : p) })); setVersion(v => v + 1); };
  const open = (project: LibraryProject, destination = projectDestination(project.id)) => {
    const current = library.projects.find(p => p.id === project.id);
    if (!current) return;
    if (current.archived) {
      setUpdates(null); setSelected(current.id);
      setActionError("Restore this archived project to Library before opening. Work and history are preserved.");
      return;
    }
    try { const scroll = region.current?.closest(".project-list-page, .mob-projects"); sessionStorage.setItem("swarmcrews:library-scroll", String(scroll?.scrollTop ?? 0)); } catch { /* optional */ }
    onOpen(current, destination);
  };
  const run = async (action: () => Promise<void>) => {
    if (operationRunning.current || busy || recoveryNeeded) return; operationRunning.current = true; setBusy(true); setActionError(null); setFeedback(null);
    try { await action(); }
    catch (err) { setActionError(err instanceof Error ? err.message : "Organization failed"); setRecoveryNeeded(!await reload(false)); }
    finally { operationRunning.current = false; setBusy(false); }
  };
  const recover = async () => { setBusy(true); try { setRecoveryNeeded(!await reload(false)); } finally { setBusy(false); } };
  const restore = (project: LibraryProject, returnFocus = false) => run(async () => {
    const restored = await restoreProject(project);
    focusResultsRequested.current = returnFocus;
    update(restored);
    setFeedback(`Restored “${project.name}” to Library, not Focus. Work and history preserved.`);
  });
  const focus = (ids: string[], returnFocus = false) => run(async () => { const saved = await saveFocus(ids, library.focusRevision); focusResultsRequested.current = returnFocus; setLibrary(saved); setFeedback("Focus desk saved. Work and files are unchanged."); });
  const move = (id: string, delta: number) => { const ids = [...desk]; const index = ids.indexOf(id); const target = index + delta; if (target < 0 || target >= ids.length) return; [ids[index], ids[target]] = [ids[target]!, ids[index]!]; void focus(ids); };
  const tags = useMemo(() => [...new Set(library.projects.flatMap(p => p.tags))].sort(), [library.projects]);
  const empty = !loading && !error && library.projects.length === 0;
  const loaded = !loading && !error;
  const filtered = Boolean(filters.query || filters.collection || filters.tag);
  const counts = { library: library.projects.filter(p => !p.archived).length, focus: desk.length, archived: library.projects.filter(p => p.archived).length };
  const [title, subtitle] = viewCopy[filters.view];
  const archiveReady = !!archiveTarget && !!summaries.summaries[archiveTarget.id]?.archiveEligible && librarySummaryFreshness(summaries.summaries[archiveTarget.id]!, summaries.now) === "fresh";
  const updatesBar = unread && unread.total > 0 ? <UpdatesBar unread={unread} onCleared={cleared => { setVersion(v => v + 1); setFeedback(`Marked ${plural(cleared, "update")} read. Work and files are unchanged.`); }} /> : null;
  const tools = <LibraryTools inline={compact} help={subtitle} actions={!compact ? actions?.(empty) : undefined} disabled={!loaded || busy || recoveryNeeded} refreshing={loading || busy} onManageCollections={() => setCollectionsOpen(true)} onCleanup={() => setCleanupOpen(true)} onRefresh={() => { setVersion(v => v + 1); void reload(); }} />;
  const navigation = <nav className="pl-nav" aria-label="Project views">{([['library', 'Library', FolderOpen], ['focus', 'Focus desk', Columns3], ['archived', 'Archived', Archive]] as const).map(([view, label, Icon]) => <button key={view} type="button" aria-pressed={filters.view === view} onClick={() => change({ view })}><Icon size={16} aria-hidden="true" />{label}{loaded && <span className="pl-count" aria-hidden="true">{counts[view]}</span>}</button>)}</nav>;
  const controls = <>
    {compact ? <>
      <p className="pl-hint">{subtitle}</p>
      {!empty && <LibraryFilterBar hideSearch filters={filters} collections={library.collections} tags={tags} onChange={change} />}
      <div className="pl-heading">{tools}</div>
    </> : <>
      <LibraryHeader subdued={filters.view === "archived"} title={title} tools={tools} navigation={navigation} empty={empty}>{registration?.(empty)}</LibraryHeader>
      {updatesBar}
    </>}
    {filters.view === "library" && desk.length > 0 && <DeskStrip projects={desk.map(id => library.projects.find(p => p.id === id)!)} onOpen={p => open(p)} />}
    {!compact && !empty && <LibraryFilterBar hideSort hideLayout filters={filters} collections={library.collections} tags={tags} onChange={change} />}
  </>;
  return <section className={`project-library${compact ? " project-library--compact" : ""}`} ref={region} aria-label="Project organization">
    {compact && <h1 className="pl-mobile-sr-only">{title}</h1>}
    <NavigationDraft scope="library-organization" pending={busy} failed={recoveryNeeded} />
    {compact ? <MobileLibraryControls filters={filters} counts={counts} loaded={loaded} unread={unread?.total ?? 0} actions={actions?.(empty)} onChange={change}>{controls}</MobileLibraryControls> : controls}
    {compact && updatesBar}
    {compact && registration?.(empty)}
    {loading && <p className="pl-loading" role="status">Loading Library…</p>}
    {error && <LibraryNotice tone="error" alert actions={<button type="button" onClick={() => void reload()} disabled={loading || busy}>Retry Library</button>}>Couldn’t load Library. Existing records are retained. {error}</LibraryNotice>}
    {summaries.error && <LibraryNotice tone="warning" actions={<button type="button" onClick={summaries.refresh}>Retry status</button>}>Status refresh unavailable. Last-known data may be stale.</LibraryNotice>}
    {actionError && <LibraryNotice tone="error" alert actions={recoveryNeeded && !detailProject && !archiveTarget ? <button type="button" disabled={busy} onClick={() => void recover()}>Refresh before retrying</button> : undefined}>{actionError} The action could not be confirmed. {recoveryNeeded ? "Latest Library could not be loaded. Refresh before retrying the organization action." : "Latest Library loaded; review it before retrying the organization action."}</LibraryNotice>}
    {feedback && <LibraryNotice tone="success" onDismiss={() => setFeedback(null)}>{feedback}</LibraryNotice>}
    {loading && library.projects.length === 0 && (filters.view === "library" ? <ProjectIndexSkeleton /> : <LibrarySkeleton layout={layout} />)}
    {filters.view === "library" && activityFeed.error && <LibraryNotice tone="warning" actions={<button type="button" onClick={activityFeed.refresh}>Retry recent activity</button>}>Recent activity refresh unavailable. Showing last recorded activity, or last opened where unavailable.</LibraryNotice>}
    <div className="pl-region">
      {filters.view === "library" ? <>
        <RecentHighlights projects={highlights} activity={activityFeed.activity} summaries={summaries.summaries} now={summaries.now} onOpen={p => open(p, { view: "activity" })} onUpdates={p => setUpdates(p.id)} onSelect={(p, workItemId) => open(p, { view: "activity", workItemId })} />
        {loaded && !empty && <div className="pl-section-heading" tabIndex={-1}><h2>{filtered ? "Matching projects" : "All projects"}</h2>{projects.length > 0 && <span>{projects.length} {projects.length === 1 ? "project" : "projects"} in Library</span>}{!compact && <LibrarySort filters={filters} onChange={change} />}</div>}
        {loaded && !projects.length && <LibraryEmpty total={library.projects.length} filters={filters} filtered={filtered} onChange={change} />}
        <div className="pl-project-index" aria-label="All projects">
          {visible.length > 0 && <div className="pl-index-columns" aria-hidden="true"><span>Project</span><span>Current activity</span><span>Recent</span><span /></div>}
          {visible.map(p => <ProjectIndexRow key={p.id} project={p} pathHint={pathHints.get(p.id)} summary={summaries.summaries[p.id]} activity={activityFeed.activity[p.id]} now={summaries.now} onOpen={() => open(p)} onDetails={() => { if (!recoveryNeeded) setActionError(null); setSelected(p.id); }} onActivity={() => open(p, { view: "activity" })} onUpdates={() => setUpdates(p.id)} />)}
        </div>
      </> : <>
        {loaded && !empty && <LibraryResultsToolbar filters={filters} total={projects.length} page={page} compact={compact} onChange={change} onPage={goToPage} />}
        {loaded && !projects.length && <LibraryEmpty total={library.projects.length} filters={filters} filtered={filtered} onChange={change} />}
        {filters.view === "archived" && projects.length > 0 && <p className="pl-archive-help">Restore returns a project to Library, not Focus. Files and history are preserved.</p>}
        <div className={`pl-projects pl-projects--${layout}`}>{visible.map(p => <div key={p.id} className="pl-project"><ProjectCard pathHint={pathHints.get(p.id)} project={p} summary={summaries.summaries[p.id]} now={summaries.now} onRestore={() => void restore(p, true)} restoreDisabled={!loaded || busy || recoveryNeeded} onOpen={() => open(p)} onDetails={() => { if (!recoveryNeeded) setActionError(null); setSelected(p.id); }} onActivity={() => open(p, { view: "activity" })} onUpdates={() => setUpdates(p.id)} />{filters.view === "focus" && <DeskActions project={p} layout={layout} first={desk.indexOf(p.id) === 0} last={desk.indexOf(p.id) === desk.length - 1} disabled={busy || recoveryNeeded} onMove={delta => move(p.id, delta)} onRemove={() => void focus(desk.filter(id => id !== p.id), true)} onOpen={destination => open(p, destination)} />}</div>)}</div>
      </>}
    </div>
    <LibraryPagination page={page} total={projects.length} position="bottom" onPage={goToPage} />
    {detailProject && <ProjectDetails key={detailProject.id} project={detailProject} collections={library.collections} suggestions={tags} onCollectionCreated={collection => setLibrary(prev => ({ ...prev, collections: [...prev.collections, collection] }))} onSaved={update} onClose={() => setSelected(null)} reload={async () => (await reload(false)) !== null} organization={<OrganizationActions project={detailProject} disabled={busy || recoveryNeeded} busy={busy} recoveryNeeded={recoveryNeeded} actionError={actionError} feedback={feedback} onDesk={() => void focus(detailProject.focusOrder === null ? [...desk, detailProject.id] : desk.filter(id => id !== detailProject.id))} onUpdates={() => { setSelected(null); setUpdates(detailProject.id); }} onRestore={() => void restore(detailProject)} onOpen={destination => open(detailProject, destination)} onArchive={() => { setSelected(null); setArchiveId(detailProject.id); }} onRecover={() => void recover()} />} />}
    {updateProject && <ProjectUpdates project={updateProject} summary={summaries.summaries[updateProject.id]} now={summaries.now} onClose={() => setUpdates(null)} onRead={() => setVersion(v => v + 1)} onOpen={destination => open(updateProject, destination)} />}
    {cleanupOpen && <MissingProjectsDialog onClose={() => setCleanupOpen(false)} onChanged={async () => { setVersion(v => v + 1); return (await reload(false)) !== null; }} />}
    {collectionsOpen && <CollectionsDialog collections={library.collections} onClose={() => setCollectionsOpen(false)} onChanged={async () => (await reload(false)) !== null} />}
    {archiveTarget && <LibraryDialog title={`Archive ${archiveTarget.name}?`} busy={busy} onClose={() => setArchiveId(null)} footer={<><button type="button" disabled={busy || recoveryNeeded} onClick={() => open(archiveTarget, { view: "activity" })}>Open Activity</button><button type="button" disabled={busy || recoveryNeeded} onClick={summaries.refresh}>Retry status</button><button className="pl-action--danger" type="button" disabled={busy || recoveryNeeded || !archiveReady} onClick={() => void run(async () => { update(await archiveProject(archiveTarget)); await reload(false); setArchiveId(null); setFeedback(`Archived “${archiveTarget.name}”. Find it in Archived to restore.`); })}>{busy ? "Archiving…" : "Confirm archive"}</button></>}><p>Repository files, workspace identity, Canvas, work history, tags and collections are preserved. This removes the project from Focus. Restore returns it to Library only.</p><p>Active agents, unresolved decisions, reviews, conflicts and unknown status block archive. The server checks again before saving.</p>{!archiveReady && <p role="status">Archive is currently unavailable. Open Activity to resolve work, or retry status.</p>}{actionError && <LibraryNotice tone="error" alert actions={recoveryNeeded ? <button type="button" disabled={busy} onClick={() => void recover()}>Refresh before retrying</button> : undefined}>{actionError}</LibraryNotice>}</LibraryDialog>}
  </section>;
}
