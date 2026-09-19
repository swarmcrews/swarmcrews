import { useContext } from "react";
import { ChatLinkContext } from "../components/ChatLink.tsx";
import { ConnectionsPanel } from "./ConnectionsPanel.tsx";
export function ConnectionSettings() {
  const context = useContext(ChatLinkContext);
  return context ? <ConnectionsPanel key={context.project} projectId={context.project} /> : <p>Open a project to manage its connections.</p>;
}
