import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CopyButton } from "../../src/components/CopyButton.tsx";
import { AddAsNodeButton } from "../../src/components/AddAsNodeButton.tsx";
import { ConfirmModal } from "../../src/components/ConfirmModal.tsx";
import { applyTheme } from "../../src/themes.ts";
import "../../src/index.css";
import "../../src/theme-skins/index.css";
import "../../src/activity.css";
import "../../src/project-list.css";
import "../../src/changes-view.css";
import "../../src/task-graph/task-graph.css";
import "../../src/settings-menu.css";
import "../../src/skills-browser.css";
import "../../src/mcp-connections/connections.css";
import "../../src/mobile/mobile.css";

applyTheme(new URLSearchParams(location.search).get("theme") ?? "midnight");

// Render actual production controls/styles without sessions or project mutations.
const families = [
  "ui-button ui-button--primary", "act-launch-btn", "act-toolbar-btn",
  "act-btn act-btn--primary", "changes-btn changes-btn--merge",
  "changes-btn changes-btn--discard", "tg-button tg-button--primary",
  "project-list-primary-action", "settings-action-add", "settings-action-reset",
  "skills-browser__launch-button", "mob-mini-btn", "mob-launch-submit",
];
function Fixture() {
  const [confirm, setConfirm] = useState(false);
  return <main style={{ height: "100%", overflow: "auto", padding: 16 }}>
    <div className="copyable" style={{ position: "relative", minHeight: 60, marginBottom: 12 }}>
      <p data-testid="copy-content">Content stays clear of the action row.</p>
      <CopyButton text="Fixture content" />
      <AddAsNodeButton text="Fixture content" onAdd={() => {}} />
    </div>
    <div style={{ display: "grid", gap: 12 }}>
      {families.map((family, index) => <div key={family} data-family={index} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button className={family}>Continue</button>
        <button className={family} disabled>Unavailable</button>
      </div>)}
      <div className="connections"><button className="connection-primary">Connect</button><button disabled>Connecting</button></div>
      <button className="ui-button" onClick={() => setConfirm(true)}>Open confirmation</button>
    </div>
    {confirm && <ConfirmModal title="Confirm example" description="Fixture only; no data will be changed."
      actions={[{ label: "Remove example", variant: "danger", onClick: () => setConfirm(false) }]}
      onClose={() => setConfirm(false)} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
