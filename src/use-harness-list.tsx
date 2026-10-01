/**
 * Harness inventory provider + hook.
 *
 * One owner per project view fetches `list_harnesses` once on connect and
 * caches the result. Components consume it via `useHarnessList()` and look
 * up by name with `findHarness(harnesses, name)`.
 * Harness-specific models surface only when their harness is in use.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { HarnessInfo } from "./harness-list.ts";
import { mergeHarnessCatalog, sameCatalog } from "./harness-catalog.ts";
import type { HarnessListEntry } from "./use-socket.ts";
import type { HarnessCatalogMessage } from "../shared/harness-catalog.ts";

interface HarnessListValue {
  harnesses: ReadonlyArray<HarnessInfo>;
  /** True once the server has answered at least one `list_harnesses` request. */
  loaded: boolean;
}

const EMPTY_VALUE: HarnessListValue = { harnesses: [], loaded: false };

const HarnessListContext = createContext<HarnessListValue>(EMPTY_VALUE);

/** Read the current harness inventory. Returns an empty array until loaded. */
export function useHarnessList(): HarnessListValue {
  return useContext(HarnessListContext);
}

interface ProviderProps {
  children: ReactNode;
  /** Send a WS command. */
  send: (data: unknown) => void;
  /** Subscribe to server messages. */
  subscribe: (fn: (msg: unknown) => void) => () => void;
  /** True when the WebSocket is open. */
  connected: boolean;
}

/**
 * Provider that issues `list_harnesses` once on connect and caches the
 * result for descendants. Re-issues on reconnect so a server with a
 * different registered set is picked up.
 */
export function HarnessListProvider({
  children,
  send,
  subscribe,
  connected,
}: ProviderProps): React.ReactElement {
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!connected) return;
    // A local/synchronous transport can answer send immediately. Install the
    // listener first and tie its lifetime to this connection generation.
    const unsubscribe = subscribe((msg) => {
      const m = msg as Partial<HarnessCatalogMessage<HarnessListEntry>>;
      if (m.type !== "harness_list" || !Array.isArray(m.harnesses)) return;
      const incoming = m.harnesses.map(toHarnessInfo);
      const replace = m.catalogMode !== "patch";
      setHarnesses(previous => {
        const next = mergeHarnessCatalog(previous, incoming, replace);
        return sameCatalog(previous, next) ? previous : next;
      });
      setLoaded(true);
    });
    send({ type: "list_harnesses" });
    return unsubscribe;
  }, [connected, send, subscribe]);

  const value = useMemo<HarnessListValue>(
    () => ({ harnesses, loaded }),
    [harnesses, loaded],
  );

  return (
    <HarnessListContext.Provider value={value}>
      {children}
    </HarnessListContext.Provider>
  );
}

function toHarnessInfo(entry: HarnessListEntry): HarnessInfo {
  return {
    name: entry.name,
    capabilities: entry.capabilities,
    builtInTools: entry.builtInTools,
    models: entry.models,
    commands: entry.commands,
    agents: entry.agents,
    account: entry.account,
  };
}
