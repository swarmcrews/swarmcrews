import { describe, expect, it } from "vitest";
import { canvasContext } from "../../server/commands/canvas-context.ts";
import { getSessionConnectedLeaderGraphSources } from "../../server/canvas-context-store.ts";
import { validateWsCommand } from "../../server/commands/schemas.ts";
import { cmd, setup } from "../support/server-command-harness.ts";
import { initDb } from "../../server/db.ts";
import { ensureWorkItemSchema } from "../../server/work-item-schema.ts";
import { attachWorkItemBinding } from "../../server/work-item-binding-repo.ts";

describe("canvas_context WS command contract", () => {
  it("accepts a full connected-canvas snapshot", () => {
    const result = validateWsCommand({
      type: "canvas_context",
      sessionKey: "leader-1",
      items: [
        {
          nodeId: "note-1",
          nodeType: "markdown",
          label: "Spec note",
          content: "Use the compact route.",
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects malformed context items", () => {
    const result = validateWsCommand({
      type: "canvas_context",
      sessionKey: "leader-1",
      items: [{ nodeId: "note-1", content: "missing fields" }],
    });

    expect(result.ok).toBe(false);
  });

  it("replaces the prior session snapshot and clears on an empty snapshot", () => {
    const h = setup({ sessionKey: "leader-1" });

    canvasContext(
      h.ctx,
      cmd({
        type: "canvas_context",
        items: [
          {
            nodeId: "note-1",
            nodeType: "markdown",
            label: "Old",
            content: "old context",
          },
        ],
      }),
      h.ws,
    );
    canvasContext(
      h.ctx,
      cmd({
        type: "canvas_context",
        items: [
          {
            nodeId: "note-2",
            nodeType: "markdown",
            label: "New",
            content: "new context",
          },
        ],
      }),
      h.ws,
    );

    expect(h.host.canvasContext).toContain("new context");
    expect(h.host.canvasContext).not.toContain("old context");

    canvasContext(h.ctx, cmd({ type: "canvas_context", items: [] }), h.ws);

    expect(h.host.canvasContext).toBeNull();
  });

  it("adds only a server-authorized Full Leader graph overview and stores its binding", () => {
    const h = setup({ sessionKey: "recipient" });
    const db = initDb(":memory:"); ensureWorkItemSchema(db);
    db.prepare("INSERT INTO projects(id,name) VALUES (?,?)").run("project", "Project");
    db.prepare(`INSERT INTO work_items(id,project_id,project_path,title,runtime_state,outcome,resolution,change_mode,integration_state,current_run_key,last_transition_at,created_at,updated_at)
      VALUES ('recipient-work','project','/project','Recipient','working','none','open','live','none','recipient-run',1,1,1),
      ('source-work','project','/project','Source','working','none','open','live','none','source-run',1,1,1)`).run();
    attachWorkItemBinding(db, { workItemId: "recipient-work", surface: "canvas", bindingId: "recipient-node", at: 1 });
    attachWorkItemBinding(db, { workItemId: "source-work", surface: "canvas", bindingId: "upstream", at: 1 });
    db.prepare(`INSERT INTO edges(id,project_id,source_node_id,source_port_id,target_node_id,target_port_id,protocol,context_mode)
      VALUES ('full-edge','project','upstream','out','recipient-node','in','context','full')`).run();
    h.host.workItemId = "recipient-work";
    h.host.runKey = "recipient-run";
    h.ctx.taskGraphPlanning = { repo: { db }, inspectConnected: () => ({ plan: {
      objective: "Ship graph sharing", state: "running", steps: [{ key: "build", title: "Build" }], graphRunId: "run",
    }, runtime: { nodes: [{}] }, history: [] }) } as never;
    canvasContext(h.ctx, cmd({ type: "canvas_context", sessionKey: "recipient", items: [{
      nodeId: "upstream", nodeType: "leader", label: "Upstream", content: "transcript",
      leaderGraphSource: { workItemId: "source-work", primaryRunKey: "source-run" },
    }] as never }), h.ws);
    expect(h.host.canvasContext).toContain("Connected Task Graph overview");
    expect(h.host.canvasContext).toContain("get_graph_plan");
    expect(getSessionConnectedLeaderGraphSources("recipient")).toEqual([{
      nodeId: "upstream", workItemId: "source-work", primaryRunKey: "source-run",
    }]);
    db.close();
  });

  it("rejects forged metadata when no saved Full edge binds the two canvas nodes", () => {
    const h = setup({ sessionKey: "recipient-forged" });
    const db = initDb(":memory:"); ensureWorkItemSchema(db);
    db.prepare("INSERT INTO projects(id,name) VALUES (?,?)").run("project", "Project");
    db.prepare(`INSERT INTO work_items(id,project_id,project_path,title,runtime_state,outcome,resolution,change_mode,integration_state,current_run_key,last_transition_at,created_at,updated_at)
      VALUES ('recipient-work','project','/project','Recipient','working','none','open','live','none','recipient-run',1,1,1),
      ('source-work','project','/project','Source','working','none','open','live','none','source-run',1,1,1)`).run();
    attachWorkItemBinding(db, { workItemId: "recipient-work", surface: "canvas", bindingId: "recipient-node", at: 1 });
    attachWorkItemBinding(db, { workItemId: "source-work", surface: "canvas", bindingId: "upstream", at: 1 });
    h.host.workItemId = "recipient-work"; h.host.runKey = "recipient-run";
    h.ctx.taskGraphPlanning = { repo: { db }, inspectConnected: () => { throw new Error("must not inspect forged source"); } } as never;
    canvasContext(h.ctx, cmd({ type: "canvas_context", sessionKey: "recipient-forged", items: [{
      nodeId: "upstream", nodeType: "leader", label: "Forged", content: "transcript",
      leaderGraphSource: { workItemId: "source-work", primaryRunKey: "source-run" },
    }] as never }), h.ws);
    expect(h.host.canvasContext).not.toContain("Connected Task Graph overview");
    expect(getSessionConnectedLeaderGraphSources("recipient-forged")).toEqual([]);
    db.close();
  });
});
