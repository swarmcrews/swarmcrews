import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initDb } from "../db.ts";
import { ensureWorkItemSchema } from "../work-item-schema.ts";
import { ensureWorktreeIntegrationSchema } from "../worktree-integration-schema.ts";
import { createWorkItem } from "../work-item-repo.ts";
import { SqliteWorktreeIntegrationService } from "../worktree-integration-sqlite.ts";
import { provisionPlannedWorktree } from "../worktree-create.ts";
import { exec } from "../worktree-exec.ts";
import { setup, cmd } from "../../tests/support/server-command-harness.ts";
import { dispatchCommand } from "./index.ts";
import { getWorktreeDiff } from "./get-worktree-diff.ts";
import { isReviewDiff } from "../../shared/review-diff.ts";
let root: string; let db: ReturnType<typeof initDb>;
afterEach(async () => { db?.close(); vi.unstubAllEnvs(); if (root) await fs.rm(root, { recursive: true, force: true }); });
class ObservedService extends SqliteWorktreeIntegrationService {
  afterRead?: () => void;
  override async getStatus(input: { lineageId?: string; workItemId?: string; runKey?: string }) {
    const result = await super.getStatus(input);
    const action = this.afterRead; this.afterRead = undefined; action?.();
    return result;
  }
}
async function fixture() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "canonical-review-"));
  vi.stubEnv("MINIONS_HOME", path.join(root, "state"));
  const repo = path.join(root, "repo"); await fs.mkdir(repo);
  await exec(["init", "-b", "main"], repo);
  await exec(["config", "user.name", "Test"], repo); await exec(["config", "user.email", "test@example.invalid"], repo);
  await exec(["config", "commit.gpgsign", "false"], repo); await exec(["config", "core.hooksPath", "/dev/null"], repo);
  await fs.writeFile(path.join(repo, "a.txt"), "base\n"); await fs.writeFile(path.join(repo, "delete.txt"), "delete\n"); await exec(["add", "."], repo); await exec(["commit", "-m", "base"], repo);
  db = initDb(":memory:"); ensureWorkItemSchema(db); ensureWorktreeIntegrationSchema(db);
  createWorkItem(db, { id: "work", projectId: "project", projectPath: repo, title: "Review", changeMode: "worktree", at: 1 });
  const service = new ObservedService(db, Date.now, undefined, undefined, undefined,
    async () => ({ allowed: true, mode: "off", gates: [] }));
  const plan = await service.bindRun({ workItemId: "work", runKey: "leader-1" });
  await provisionPlannedWorktree(plan); service.transitionProvisioning("leader-1", "active");
  const h = setup({ cwd: plan.path }); h.host.workItemId = "work";
  h.host.worktree = { ...plan, lifecycle: "active" }; h.ctx.worktreeIntegrations = service;
  return { h, service, plan, repo };
}
describe("immutable canonical review command", () => {
  it("reads the collected base/head, excludes later dirt, and never reviews or stages", async () => {
    const { h, service, plan, repo } = await fixture();
    await fs.writeFile(path.join(plan.path, "a.txt"), "collected\n");
    await service.collectRun("leader-1", "completed");
    const before = await service.getStatus({ runKey: "leader-1" });
    const entry = before!.contributions[0]!;
    await fs.writeFile(path.join(plan.path, "a.txt"), "later dirt\n");
    await fs.writeFile(path.join(plan.path, "late.txt"), "not reviewed\n");
    const status = (await exec(["status", "--porcelain=v1"], plan.path)).stdout;
    const target = (await exec(["rev-parse", "HEAD"], repo)).stdout;
    getWorktreeDiff(h.ctx, cmd({ type: "get_worktree_diff", requestId: "canonical" }), h.ws);
    await vi.waitFor(() => expect(h.wsSent).toHaveLength(1));
    const diff = h.wsSent[0]!["diff"];
    expect(h.wsSent[0]).toMatchObject({ success: true, diff: {
      filesChanged: 1, snapshot: { contributionBinding: "bound", consistency: "immutable",
        contributionId: entry.id, contributionRevision: entry.revision, lineageId: before!.id,
        baseSha: entry.baseSha, headSha: entry.headSha, runKey: "leader-1" },
      files: [{ file: "a.txt", patch: { text: expect.stringContaining("+collected") } }] } });
    expect(JSON.stringify(diff)).not.toContain("later dirt"); expect(JSON.stringify(diff)).not.toContain("late.txt");
    expect(isReviewDiff(diff)).toBe(true);
    expect(await service.getStatus({ runKey: "leader-1" })).toEqual(before);
    expect((await exec(["status", "--porcelain=v1"], plan.path)).stdout).toBe(status);
    expect((await exec(["rev-parse", "HEAD"], repo)).stdout).toBe(target); expect(h.busSent).toHaveLength(0);
  });
  it("renders canonical rename/delete/binary/large states without reading mutable paths", async () => {
    const { h, service, plan } = await fixture();
    await fs.rename(path.join(plan.path, "a.txt"), path.join(plan.path, "renamed.txt"));
    await fs.unlink(path.join(plan.path, "delete.txt"));
    await fs.writeFile(path.join(plan.path, "binary.bin"), Buffer.from([0, 1, 2]));
    await fs.writeFile(path.join(plan.path, "large.txt"), "large line\n".repeat(2500));
    await service.collectRun("leader-1", "completed");
    await fs.unlink(path.join(plan.path, "renamed.txt"));
    await fs.symlink("/not-a-readable-fixture", path.join(plan.path, "renamed.txt"));
    getWorktreeDiff(h.ctx, cmd({ type: "get_worktree_diff" }), h.ws);
    await vi.waitFor(() => expect(h.wsSent).toHaveLength(1));
    const diff = h.wsSent[0]!["diff"];
    if (!isReviewDiff(diff)) throw new Error("Expected valid immutable evidence");
    expect(diff.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "renamed.txt", previousFile: "a.txt", status: "renamed", patch: { state: "text", text: expect.stringContaining("rename from a.txt") } }),
      expect.objectContaining({ file: "delete.txt", status: "deleted", patch: { state: "text", text: expect.stringContaining("-delete") } }),
      expect.objectContaining({ file: "binary.bin", patch: expect.objectContaining({ state: "binary" }) }),
      expect.objectContaining({ file: "large.txt", patch: expect.objectContaining({ state: "large" }) }),
    ]));
  });
  it("fails closed on a cross-work-item canonical binding", async () => {
    const { h, service, plan } = await fixture();
    await fs.writeFile(path.join(plan.path, "a.txt"), "collected\n"); await service.collectRun("leader-1", "completed");
    h.host.workItemId = "other-work";
    getWorktreeDiff(h.ctx, cmd({ type: "get_worktree_diff" }), h.ws);
    await vi.waitFor(() => expect(h.wsSent).toHaveLength(1));
    expect(h.wsSent[0]).toMatchObject({ success: false, error: "Contribution does not belong to this work item." });
  });

});


it("reads an archived contribution by durable identity with no registered host", async () => {
  const { h, service, plan } = await fixture();
  await fs.writeFile(path.join(plan.path, "a.txt"), "durable reviewed\n");
  await service.collectRun("leader-1", "completed");
  const before = (await service.getStatus({ runKey: "leader-1" }))!;
  const entry = before.contributions[0]!;
  await fs.writeFile(path.join(plan.path, "a.txt"), "later mutable\n");
  h.ctx.registry = new (h.ctx.registry.constructor as { new(): typeof h.ctx.registry })();
  dispatchCommand(h.ctx, { type: "get_integration_review_diff", lineageId: before.id, contributionId: entry.id, requestId: "archived" }, h.ws);
  await vi.waitFor(() => expect(h.wsSent).toHaveLength(1));
  expect(h.wsSent[0]).toMatchObject({ topic: `lineage:${before.id}`, type: "integration_review_diff_response",
    requestId: "archived", success: true, lineageId: before.id, contributionId: entry.id,
    diff: { snapshot: { contributionBinding: "bound", contributionId: entry.id, runKey: "leader-1" },
      files: [{ patch: { text: expect.stringContaining("+durable reviewed") } }] } });
  expect(JSON.stringify(h.wsSent[0])).not.toContain("later mutable");
  expect(await service.getStatus({ lineageId: before.id })).toEqual(before);
  expect(h.busSent).toHaveLength(0);
});

it("reads the actual combined head, not the last contribution or dirty integration files", async () => {
  const { h, service, plan, repo } = await fixture();
  await fs.writeFile(path.join(plan.path, "a.txt"), "contribution only\n");
  await service.collectRun("leader-1", "completed");
  const before = (await service.getStatus({ runKey: "leader-1" }))!;
  await fs.writeFile(path.join(repo, "combined.txt"), "combined result\n");
  await exec(["add", "combined.txt"], repo); await exec(["commit", "-m", "combined fixture"], repo);
  const combined = (await exec(["rev-parse", "HEAD"], repo)).stdout.trim();
  db.prepare("UPDATE worktree_lineages SET integration_head_sha=?,revision=revision+1 WHERE id=?").run(combined, before.id);
  const current = (await service.getStatus({ lineageId: before.id }))!;
  await fs.writeFile(path.join(repo, "combined.txt"), "dirty combined\n");
  const status = (await exec(["status", "--porcelain=v1"], repo)).stdout;
  dispatchCommand(h.ctx, { type: "get_integration_review_diff", lineageId: current.id, requestId: "combined" }, h.ws);
  await vi.waitFor(() => expect(h.wsSent).toHaveLength(1));
  expect(h.wsSent[0]).toMatchObject({ success: true, diff: {
    snapshot: { contributionBinding: "lineage", lineageId: current.id, lineageRevision: current.revision,
      baseSha: current.baseSha, headSha: combined, consistency: "immutable" },
    files: [{ file: "combined.txt", patch: { text: expect.stringContaining("+combined result") } }] } });
  const diff = h.wsSent[0]!["diff"];
  expect(isReviewDiff(diff)).toBe(true);
  expect(JSON.stringify(diff)).not.toContain("dirty combined");
  expect(JSON.stringify(diff)).not.toContain("contribution only");
  expect(await service.getStatus({ lineageId: before.id })).toEqual(current);
  expect((await exec(["status", "--porcelain=v1"], repo)).stdout).toBe(status);
  expect(h.busSent).toHaveLength(0);
});

it("returns correlated errors for unknown and cross-lineage contribution IDs", async () => {
  const { h, service } = await fixture();
  const line = (await service.getStatus({ runKey: "leader-1" }))!;
  for (const query of [{ lineageId: "unknown" }, { lineageId: line.id, contributionId: "not-in-lineage" }]) {
    dispatchCommand(h.ctx, { type: "get_integration_review_diff", ...query, requestId: "missing" }, h.ws);
    await vi.waitFor(() => expect(h.wsSent.at(-1)).toMatchObject({ type: "integration_review_diff_response",
      requestId: "missing", success: false, code: "not_found", lineageId: query.lineageId }));
    h.wsSent.length = 0;
  }
});


it.each(["contribution", "lineage"] as const)("rejects a %s revision race rather than returning stale evidence", async kind => {
  const { h, service, plan } = await fixture();
  await fs.writeFile(path.join(plan.path, "a.txt"), "captured\n"); await service.collectRun("leader-1", "completed");
  const line = (await service.getStatus({ runKey: "leader-1" }))!, entry = line.contributions[0]!;
  db.prepare("UPDATE worktree_lineages SET integration_head_sha=? WHERE id=?").run(entry.headSha, line.id);
  const table = kind === "lineage" ? "worktree_lineages" : "worktree_contributions";
  service.afterRead = () => db.prepare(`UPDATE ${table} SET revision=revision+1 WHERE id=?`).run(kind === "lineage" ? line.id : entry.id);
  dispatchCommand(h.ctx, { type: "get_integration_review_diff", lineageId: line.id,
    ...(kind === "contribution" ? { contributionId: entry.id } : {}), requestId: "racing" }, h.ws);
  await vi.waitFor(() => expect(h.wsSent).toHaveLength(1));
  expect(h.wsSent[0]).toMatchObject({ type: "integration_review_diff_response", requestId: "racing",
    success: false, code: "conflict", error: expect.stringContaining("changed while capturing") });
  expect(h.wsSent[0]).not.toHaveProperty("diff"); expect(h.busSent).toHaveLength(0);
});

it("reports uncollected/missing combined heads without substituting mutable working files", async () => {
  const { h, service, plan } = await fixture();
  const line = (await service.getStatus({ runKey: "leader-1" }))!, entry = line.contributions[0]!;
  await fs.writeFile(path.join(plan.path, "a.txt"), "not collected\n");
  // An uncollected contribution with null head must never fall back to the live tree.
  db.prepare("UPDATE worktree_contributions SET head_sha=NULL WHERE id=?").run(entry.id);
  for (const contributionId of [entry.id, undefined]) {
    dispatchCommand(h.ctx, { type: "get_integration_review_diff", lineageId: line.id,
      ...(contributionId ? { contributionId } : {}), requestId: "not-ready" }, h.ws);
    await vi.waitFor(() => expect(h.wsSent).toHaveLength(1));
    expect(h.wsSent[0]).toMatchObject({ success: false, code: "invalid_state", requestId: "not-ready" });
    expect(h.wsSent[0]).not.toHaveProperty("diff"); h.wsSent.length = 0;
  }
});
