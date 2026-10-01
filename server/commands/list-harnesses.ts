/* Progressive harness inventory: full immediate baseline, then singleton updates. */
import { unicastGlobal } from "../bus.ts";
import { productionHarnesses } from "../harness/index.ts";
import { displayModels, rememberDisplayModels } from "../harness/catalog-discovery.ts";
import { watchHarnessReadiness } from "../harness/readiness.ts";
import type { HarnessReadiness } from "../harness/readiness-types.ts";
import type { CommandHandler } from "./types.ts";
import type { WebSocket } from "ws";

const pending = new WeakSet<WebSocket>();

export const listHarnesses: CommandHandler = (_ctx, _cmd, ws) => {
  if (pending.has(ws)) return; // Repeated bootstrap requests share this socket's stream.
  pending.add(ws);
  const harnesses = productionHarnesses();
  // Capture last-known native inventories before a fresh readiness check can
  // clear authoritative model arrays. This cache is for display only.
  for (const harness of harnesses) rememberDisplayModels(harness.name, harness.staticInfo().models);
  const byName = new Map<string, HarnessReadiness>();
  let initialSent = false;
  const entry = (name: string) => {
    const harness = harnesses.find(h => h.name === name);
    if (!harness) return null;
    const info = harness.staticInfo();
    const readiness = byName.get(name);
    const models = displayModels(name, info.models);
    return {
      name: harness.name, capabilities: harness.capabilities, builtInTools: harness.builtInTools,
      models, commands: info.commands, agents: info.agents, account: info.account,
      ...(readiness ? { readiness } : {}),
    };
  };
  const stream = watchHarnessReadiness(item => {
    byName.set(item.name, item);
    if (!initialSent || ws.readyState !== 1) return;
    const harness = harnesses.find(h => h.name === item.name);
    if (!harness) return;
    if (item.ready) rememberDisplayModels(item.name, harness.staticInfo().models);
    const update = entry(item.name);
    if (update) unicastGlobal(ws, { type: "harness_list", catalogMode: "patch", harnesses: [update] });
  });
  for (const item of stream.current) byName.set(item.name, item);
  // Cached native catalogs may be cleared at the start of a fresh probe. Capture
  // the previous display independently, without treating it as launch readiness.
  const initial = harnesses.map(harness => {
    const info = harness.staticInfo();
    if (info.models.length && byName.get(harness.name)?.ready) rememberDisplayModels(harness.name, info.models);
    return entry(harness.name)!;
  });
  unicastGlobal(ws, { type: "harness_list", catalogMode: "snapshot", harnesses: initial });
  initialSent = true;
  const cleanup = () => { stream.stop(); ws.off("close", cleanup); pending.delete(ws); };
  ws.once("close", cleanup);
  void stream.done.then(cleanup, cleanup);
};
