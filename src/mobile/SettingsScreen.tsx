import { ConnectionsPanel } from "../mcp-connections/ConnectionsPanel.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getProjectSettings,
  restartServer,
  updateProjectSettings,
  type ProjectSettings,
} from "../api.ts";
import { buildModelGroups } from "../SettingsMenu.tsx";
import { useHarnessList } from "../use-harness-list.tsx";
import { MobileMinionModelSettings } from "./MobileMinionModelSettings.tsx";

interface SettingsScreenProps {
  project: {
    id: string;
    name: string;
    path: string;
  };
}

type SaveState = "idle" | "saving" | "saved" | "error";
type RestartState = "idle" | "pending" | "sent";
export function SettingsScreen({ project }: SettingsScreenProps) {
  const [settings, setSettings] = useState<ProjectSettings>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [restartState, setRestartState] = useState<RestartState>("idle");
  const [restartError, setRestartError] = useState<string | null>(null);
  const { harnesses, loaded: harnessesLoaded } = useHarnessList();
  const modelGroups = useMemo(
    () => buildModelGroups(harnesses, harnessesLoaded),
    [harnesses, harnessesLoaded],
  );

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setSaveState("idle");
    void getProjectSettings(project.id)
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load settings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const saveSettings = useCallback(
    (next: ProjectSettings) => {
      setSettings(next);
      setSaveState("saving");
      void updateProjectSettings(project.id, next)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    },
    [project.id],
  );

  const requestRestart = useCallback(() => {
    setRestartState("pending");
    setRestartError(null);
    void restartServer()
      .then(() => setRestartState("sent"))
      .catch((err: unknown) => {
        setRestartState("idle");
        setRestartError(err instanceof Error ? err.message : "Failed to restart server");
      });
  }, []);

  return (
    <main className="mob-screen mob-settings" aria-label="Settings">
      <header className="mob-screen-header">
        <div>
          <h1>Settings</h1>
          <p className="mob-settings-project">{project.name}</p>
        </div>
        <span className="mob-settings-save" data-state={saveState} role="status" aria-live="polite">
          {saveState === "saving"
            ? "Saving"
            : saveState === "saved"
              ? "Saved"
              : saveState === "error"
                ? "Save failed"
                : ""}
        </span>
      </header>

      {loading ? <div className="mob-launch-status">Loading settings...</div> : null}
      {loadError ? <div className="mob-launch-error" role="alert">{loadError}</div> : null}

      {!loading && !loadError ? (
        <>
          <section className="mob-settings-group" aria-labelledby="mob-project-defaults-heading">
            <div className="mob-settings-group-heading">
              <h2 id="mob-project-defaults-heading">Project defaults</h2>
              <p>Choose how new Minion and role work starts in this project.</p>
            </div>
            <MobileMinionModelSettings
              settings={settings}
              harnesses={harnesses}
              modelGroups={modelGroups}
              saveSettings={saveSettings}
            />

            <details className="mob-settings-disclosure">
              <summary id="mob-role-system-heading">
                <span className="mob-settings-disclosure-title">Role System <small>Beta</small></span>
                <span className="mob-settings-disclosure-description">
                  Apply adaptive expert role contracts to new Leader and Minion sessions.
                </span>
              </summary>
              <div className="mob-settings-disclosure-content" aria-labelledby="mob-role-system-heading">
                <label className="mob-settings-toggle">
                  <span>
                    <strong>Enable adaptive expert roles</strong>
                    <small>Agents infer a focused role or refine one supplied in the task.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.roleSystemBeta === true}
                    onChange={(event) =>
                      saveSettings({ ...settings, roleSystemBeta: event.target.checked })
                    }
                  />
                </label>
              </div>
            </details>
          </section>

          <section className="mob-settings-group" aria-labelledby="mob-administration-heading">
            <div className="mob-settings-group-heading">
              <h2 id="mob-administration-heading">Connections & administration</h2>
              <p>Manage project tools and the running Swarmcrews server.</p>
            </div>
            <details className="mob-settings-disclosure">
              <summary id="mob-connections-heading">
                <span className="mob-settings-disclosure-title">Connections</span>
                <span className="mob-settings-disclosure-description">
                  Add and manage project tools available to your agents.
                </span>
              </summary>
              <div className="mob-settings-disclosure-content" aria-labelledby="mob-connections-heading">
                <ConnectionsPanel key={project.id} projectId={project.id} />
              </div>
            </details>

            <details className="mob-settings-disclosure mob-settings-disclosure--danger">
              <summary id="mob-server-heading">
                <span className="mob-settings-disclosure-title">Server</span>
                <span className="mob-settings-disclosure-description">
                  Restart the active backend to pick up changed code.
                </span>
              </summary>
              <div className="mob-settings-disclosure-content" aria-labelledby="mob-server-heading">
                <button
                  type="button"
                  className="mob-settings-danger-button"
                  onClick={() => {
                    setRestartError(null);
                    setRestartDialogOpen(true);
                  }}
                >
                  Restart Server
                </button>
              </div>
            </details>
          </section>
        </>
      ) : null}

      {restartDialogOpen ? (
        <div
          className="mob-settings-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && restartState !== "pending") {
              setRestartDialogOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Restart Swarmcrews server"
            className="mob-settings-modal"
          >
            <h2>Restart Swarmcrews server?</h2>
            <p>
              {restartState === "sent"
                ? "Restart requested. The app will reconnect when the server is back."
                : "Active sessions will disconnect while the backend restarts. Use this only when you need the running server to pick up new code."}
            </p>
            {restartError ? <div className="mob-launch-error" role="alert">{restartError}</div> : null}
            <div className="mob-settings-modal-actions">
              <button
                type="button"
                onClick={() => {
                  if (restartState !== "pending") {
                    setRestartDialogOpen(false);
                    if (restartState === "sent") setRestartState("idle");
                  }
                }}
                disabled={restartState === "pending"}
              >
                {restartState === "sent" ? "Close" : "Cancel"}
              </button>
              {restartState !== "sent" ? (
                <button
                  type="button"
                  className="mob-settings-danger-button"
                  onClick={requestRestart}
                  disabled={restartState === "pending"}
                >
                  {restartState === "pending" ? "Restarting..." : "Restart Server"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
