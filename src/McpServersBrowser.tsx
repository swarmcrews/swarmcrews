import { useState } from "react";
import { DockPanel, DockPanelHeader, useDockBadge, useDockPanelOpen } from "./BottomRightDock.tsx";
import { ConnectionsPanel } from "./mcp-connections/ConnectionsPanel.tsx";

export interface McpServersBrowserProps { projectId: string; refreshKey?: number }
export function McpServersBrowser({ projectId }: McpServersBrowserProps) {
  const open = useDockPanelOpen("mcp");
  const [count, setCount] = useState(0);
  useDockBadge("mcp", { count });
  if (!open) return null;
  return <DockPanel id="mcp" width={480}><DockPanelHeader title="Connections" /><div style={{ overflowY: "auto", minHeight: 0 }}><ConnectionsPanel key={projectId} projectId={projectId} onCount={setCount} /></div></DockPanel>;
}
