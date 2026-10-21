import { NavigationBlockedDialog } from "../project-library/NavigationBlockedDialog.tsx";
import { hasNavigationDraft, NavigationDraft } from "../navigation-drafts.tsx";
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Server } from "lucide-react";
import { SettingsPreferences } from "../SettingsPreferences.tsx";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "../settings-categories.ts";
import { ConnectionsPanel } from "../mcp-connections/ConnectionsPanel.tsx";
import type { SocketSubscribe } from "../use-socket.ts";
import { useMobileProjectSettings } from "./use-mobile-project-settings.ts";
import { MobileServerSettings } from "./MobileServerSettings.tsx";
import { MobileActionSettings } from "./MobileActionSettings.tsx";
import "./mobile-settings.css";

interface SettingsScreenProps {
  project: { id: string; name: string; path: string };
  socketSend?: ((data: unknown) => void) | undefined;
  socketSubscribe?: SocketSubscribe | undefined;
}
type Category = SettingsCategory | "server";

export function SettingsScreen({ project, socketSend, socketSubscribe }: SettingsScreenProps) {
  // A project switch starts a new navigation/save scope, including pending results.
  return <ProjectSettingsScreen key={project.id} project={project} socketSend={socketSend} socketSubscribe={socketSubscribe} />;
}

function ProjectSettingsScreen({ project, socketSend, socketSubscribe }: SettingsScreenProps) {
  const { settings, loading, loadError, saveState, save, retrySave, reload } = useMobileProjectSettings(project.id);
  const [category, setCategory] = useState<Category | null>(null);
  const root = useRef<HTMLElement>(null);
  const [blocked, setBlocked] = useState(false);
  const leaveCategory = () => hasNavigationDraft(root.current) ? setBlocked(true) : setCategory(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const lastCategory = useRef<Category | null>(null);
  const title = category === "server" ? "Server" : SETTINGS_CATEGORIES.find(item => item.id === category)?.label ?? "Settings";

  useLayoutEffect(() => {
    if (category) {
      lastCategory.current = category;
      heading.current?.focus({ preventScroll: true });
      heading.current?.closest("main")?.scrollTo?.({ top: 0 });
    } else if (lastCategory.current) {
      navigation.current?.querySelector<HTMLButtonElement>(`[data-category="${lastCategory.current}"]`)?.focus();
    }
  }, [category]);

  return (
    <main ref={root} className="mob-screen mob-settings" aria-label="Settings">
      {blocked && <NavigationBlockedDialog onClose={() => setBlocked(false)} />}
      <NavigationDraft scope="mobile-settings-save" pending={saveState.status === "saving"} failed={saveState.status === "error"} />
      <header className="mob-settings-header">
        {category && <button type="button" className="mob-settings-back" onClick={leaveCategory}>
          <ArrowLeft size={18} aria-hidden="true" />All settings
        </button>}
        <div className="mob-settings-title-row">
          <div><h1 ref={heading} tabIndex={-1}>{title}</h1><p className="mob-settings-project">{project.name}</p></div>
          <span className="mob-settings-save" data-state={saveState.status} role="status" aria-live="polite">
            {saveState.status === "saving" ? "Saving…" : saveState.status === "saved" ? "Saved" : saveState.status === "error" ? "Not saved" : ""}
          </span>
        </div>
      </header>

      {loading && <p className="mob-launch-status" role="status">Loading settings…</p>}
      {loadError && <div className="mob-settings-error" role="alert"><p>{loadError}</p>
        <button type="button" onClick={reload}>Retry loading settings</button></div>}
      {saveState.status === "error" && <div className="mob-settings-error" role="alert">
        <p>{saveState.error ?? "Your changes could not be saved."} Your edits are still here.</p>
        <button type="button" onClick={retrySave}>Retry saving settings</button>
      </div>}

      {!loading && !loadError && (category === null ? (
        <nav ref={navigation} className="mob-settings-index" aria-label="Settings categories">
          <p className="mob-settings-intro">Project preferences, wherever you work. Changes apply to new sessions unless noted.</p>
          {(["project", "labs"] as const).map(section => <section key={section} aria-label={section === "labs" ? "Labs" : "Project preferences"}>
            <div className="mob-settings-section-label"><span>{section === "labs" ? "Labs" : "Project"}</span>
              {section === "labs" && <span className="settings-beta-badge">Beta</span>}
            </div>
            <div className="mob-settings-category-list">
              {SETTINGS_CATEGORIES.filter(item => item.section === section).map(item => {
                const Icon = item.icon;
                return <button key={item.id} type="button" data-category={item.id} className="mob-settings-category" onClick={() => setCategory(item.id)}>
                  <span className="mob-settings-category-icon"><Icon size={20} aria-hidden="true" /></span>
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>;
              })}
            </div>
          </section>)}
          <section aria-label="Administration">
            <div className="mob-settings-section-label">Administration</div>
            <div className="mob-settings-category-list"><button type="button" data-category="server" className="mob-settings-category" onClick={() => setCategory("server")}>
              <span className="mob-settings-category-icon"><Server size={20} aria-hidden="true" /></span>
              <span><strong>Server</strong><small>Restart and reconnect</small></span><ChevronRight size={18} aria-hidden="true" />
            </button></div>
          </section>
          <p className="mob-settings-footnote">Preferences save automatically for this project. Themes apply across the app.</p>
        </nav>
      ) : (
        <div className="mob-settings-detail">
          {category === "server" ? <MobileServerSettings /> : category === "connections" ? <ConnectionsPanel projectId={project.id} /> :
            category === "actions" ? <MobileActionSettings projectId={project.id} settings={settings} onSettingsChange={save} settingsSaveState={saveState} onRetrySettingsSave={retrySave} /> :
            <SettingsPreferences key={category} category={category} settings={settings} onSettingsChange={save}
              settingsSaveState={saveState} onRetrySettingsSave={retrySave} socketSend={socketSend} socketSubscribe={socketSubscribe} />}
        </div>
      ))}
    </main>
  );
}
