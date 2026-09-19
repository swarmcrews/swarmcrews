import { parseMcpServerEntry } from "../../shared/mcp-servers/types.ts";
import { listMcpServers, saveMcpServer } from "../mcp-server-store.ts";
import { redactEntry, restoreSecrets } from "./credentials.ts";
import { cancelAuthorization } from "./oauth.ts";
import { invalidateConnection } from "./runtime.ts";

/** Shared save path for the browser and Leader tools. Never return credentials. */
export async function saveConnectionConfiguration(project: string, input: unknown) {
  const draft = parseMcpServerEntry(input);
  const previous = listMcpServers(project).entries.find(entry => entry.id === draft.id);
  const entry = saveMcpServer(project, restoreSecrets(draft, previous));
  cancelAuthorization(project, entry.id);
  await invalidateConnection(project, entry.id);
  return redactEntry(entry);
}
