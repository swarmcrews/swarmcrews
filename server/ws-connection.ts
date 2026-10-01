/**
 * Per-connection WebSocket wiring.
 *
 * Isolates the listener contract so it can be tested without booting the
 * HTTP server. The function attaches every listener
 * a freshly-accepted client needs:
 *
 *   - `error`   — keeps `ws`-internal errors (e.g. `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`
 *                 when a client sends a frame larger than `WS_MAX_PAYLOAD_BYTES`)
 *                 from bubbling out as an unhandled `'error'` event and
 *                 crashing the Node process. The library will follow the
 *                 error with `close` (code 1009) on its own; no need for
 *                 explicit cleanup here.
 *   - `message` — JSON-decode + dispatch through the command table.
 *   - `close`   — log the disconnect.
 *
 * Inventory is requested only after a project has been selected.
 */

import type { WebSocket } from "ws";
import { clearConnectionSubscriptions, setConnectionProject } from "./session-subscriptions.ts";
import { unicastGlobal } from "./bus.ts";
import type { WsCommand } from "./commands/index.ts";
import { validateWsCommand } from "./commands/schemas.ts";
import { serverLogger } from "./logging.ts";

const log = serverLogger.child("ws-connection");

export interface ConnectionDeps {
  /** Route a parsed WS command. */
  dispatch: (cmd: WsCommand, ws: WebSocket) => void;
}

export function attachConnectionListeners(
  ws: WebSocket,
  deps: ConnectionDeps,
): void {
  log.debug("client_connected");
  setConnectionProject(ws, null);

  ws.on("error", (err: unknown) => {
    log.warn("connection_error", { error: err });
  });

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      unicastGlobal(ws, { type: "error", message: msg });
      return;
    }
    const validation = validateWsCommand(parsed);
    if (!validation.ok) {
      log.warn("command_rejected", { error: validation.error });
      unicastGlobal(ws, { type: "error", message: validation.error });
      return;
    }
    deps.dispatch(validation.cmd, ws);
  });

  ws.on("close", () => {
    clearConnectionSubscriptions(ws);
    log.debug("client_disconnected");
  });
}
