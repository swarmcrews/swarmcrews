import { hasNavigationDraft, NavigationDraft } from "./navigation-drafts.tsx";
import { NavigationBlockedDialog } from "./project-library/NavigationBlockedDialog.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ConnectionSettings } from "./mcp-connections/ConnectionSettings.tsx";
import { SettingsPreferences, type SettingsPreferencesProps } from "./SettingsPreferences.tsx";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "./settings-categories.ts";
import "./settings-menu.css";

/**
 * Header-anchored settings menu. Renders a gear button in the project
 * header; clicking opens a popover with theme + per-project preferences.
 */
export function SettingsMenu({
  settings,
  onSettingsChange,
  settingsSaveState,
  onRetrySettingsSave,
  socketSend,
  socketSubscribe,
}: Omit<SettingsPreferencesProps, "category">) {
  const [open, setOpen] = useState(false);
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const canLeave = useCallback(() => {
    if (hasNavigationDraft(containerRef.current)) { setNavigationBlocked(true); return false; }
    return true;
  }, []);
  // Nonmodal: keyboard dismissal restores the opener; pointer dismissal
  // leaves focus with the user's next target. Nested controls consume Escape first.
  useEffect(() => {
    if (!open || navigationBlocked) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node) && canLeave()) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (!canLeave()) { e.preventDefault(); return; }
      setOpen(false);
      if (containerRef.current?.contains(document.activeElement)) {
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, navigationBlocked, canLeave]);
  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        ref={triggerRef}
        aria-label="Open settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => { if (!open || canLeave()) setOpen(!open); }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          padding: 0,
          background: open ? "var(--bg-elevated)" : "transparent",
          border: "1px solid var(--border-default)",
          borderRadius: 6,
          color: "var(--text-secondary)",
          cursor: "pointer",
          transition: "background 120ms ease, border-color 120ms ease",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.borderColor = "var(--border-hover)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.borderColor = "var(--border-default)")
        }
      >
        <GearIcon />
      </button>
      {open && <NavigationDraft scope="desktop-settings" pending={settingsSaveState?.status === "saving"} failed={settingsSaveState?.status === "error"} />}
      {navigationBlocked && <NavigationBlockedDialog onClose={() => setNavigationBlocked(false)} />}
      {open && (
        <SettingsPopover
          canLeave={canLeave}
          settings={settings}
          onSettingsChange={onSettingsChange}
          settingsSaveState={settingsSaveState}
          onRetrySettingsSave={onRetrySettingsSave}
          socketSend={socketSend}
          socketSubscribe={socketSubscribe}
        />
      )}
    </div>
  );
}
// ── Popover body ────────────────────────────────────────────

function SettingsPopover({ canLeave, ...props }: Omit<SettingsPreferencesProps, "category"> & { canLeave: () => boolean }) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("general");
  return (
    <div role="dialog" aria-label="Settings" className="settings-dialog">
        <aside className="settings-sidebar">
          <div className="settings-sidebar__heading">
            <span>Project</span>
            <strong>Settings</strong>
          </div>
          <nav aria-label="Settings categories" className="settings-nav">
            {(["project", "labs"] as const).map((section) => (
              <div className="settings-nav__group" key={section}>
                <span className="settings-nav__group-label">
                  {section === "project" ? "Project" : "Labs"}
                  {section === "labs" && <span className="settings-beta-badge">Beta</span>}
                </span>
                {SETTINGS_CATEGORIES
                  .filter((category) => category.section === section)
                  .map((category) => {
                    const Icon = category.icon;
                    const selected = activeCategory === category.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        aria-current={selected ? "page" : undefined}
                        className="settings-nav__item"
                        onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" })}
                        onClick={() => { if (category.id !== activeCategory && canLeave()) setActiveCategory(category.id); }}
                      >
                        <Icon size={16} aria-hidden="true" />
                        <span>
                          <strong>
                            <span className="settings-nav__label">{category.label}</span>
                          </strong>
                          <small>{category.description}</small>
                        </span>
                        <ChevronRight
                          className="settings-nav__chevron"
                          size={14}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
              </div>
            ))}
          </nav>
          <p className="settings-sidebar__note">{activeCategory === "connections" ? "Save and test a connection to make it available to this project." : "Changes save automatically for this project."}</p>
        </aside>

      <main className="settings-content">
        {activeCategory !== "actions" && (props.settingsSaveState?.status === "saving" || props.settingsSaveState?.status === "error") && <div role="status">
          {props.settingsSaveState.status === "saving" ? "Saving settings…" : "Settings not saved. Retry before leaving."}
          {props.settingsSaveState.status === "error" && props.onRetrySettingsSave && <button type="button" onClick={props.onRetrySettingsSave}>Retry settings save</button>}
        </div>}
        {activeCategory === "connections" ? <ConnectionSettings /> :
          <SettingsPreferences {...props} category={activeCategory} />}
      </main>
    </div>
  );
}
function GearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.2" />
      <path d="M13 8c0 .42-.04.83-.13 1.22l1.43 1.1-1.5 2.6-1.7-.6c-.6.5-1.3.9-2.05 1.13L8.8 15h-1.6l-.25-1.55c-.75-.23-1.45-.62-2.05-1.13l-1.7.6-1.5-2.6 1.43-1.1A6 6 0 013 8c0-.42.04-.83.13-1.22L1.7 5.68l1.5-2.6 1.7.6c.6-.5 1.3-.9 2.05-1.13L7.2 1h1.6l.25 1.55c.75.23 1.45.62 2.05 1.13l1.7-.6 1.5 2.6-1.43 1.1c.09.4.13.8.13 1.22z" />
    </svg>
  );
}
