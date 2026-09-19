import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionHost } from "./session-host.ts";
import { buildSessionListItem, buildSessionListItems } from "./session-list-item.ts";
import { registerWorkspace } from "./workspace-registry.ts";

describe("buildSessionListItem run identity", () => {
  it("exposes additive canonical primary/child metadata", () => {
    const host = new SessionHost("child-run", "/repo");
    host.workItemId = "work-1";
    host.seedRunLineage({
      runKind: "child", parentRunKey: "primary-run", taskId: "task-1",
    });

    expect(buildSessionListItem(host.id, host)).toMatchObject({
      sessionKey: "child-run", runKey: "child-run", workItemId: "work-1",
      runKind: "child", parentRunKey: "primary-run", taskId: "task-1",
    });
  });
});

describe("session snapshot workspace lookups", () => {
  let home: string;
  let source: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "session-list-workspaces-"));
    source = path.join(home, "repo");
    fs.mkdirSync(source);
    vi.stubEnv("MINIONS_HOME", home);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("preserves every session's workspace identity while reading the registry once", () => {
    const workspace = registerWorkspace(source)!;
    const hosts: Array<[string, SessionHost]> = Array.from({ length: 100 }, (_, i) => {
      const key = `session-${i}`;
      return [key, new SessionHost(key, source)];
    });
    const expected = hosts.map(([key, host]) => buildSessionListItem(key, host));
    const reads = vi.spyOn(fs, "readFileSync");
    try {
      const snapshot = buildSessionListItems(hosts);
      expect(snapshot).toEqual(expected);
      expect(snapshot.every((item) => item.projectId === workspace.id)).toBe(true);
      expect(reads.mock.calls.filter(([file]) => String(file).endsWith("registry.json"))).toHaveLength(1);
    } finally {
      reads.mockRestore();
    }
  });

  it("keeps sessions visible when the registry is malformed and recovers on the next snapshot", () => {
    const workspace = registerWorkspace(source)!;
    const registryPath = path.join(home, "workspaces", "registry.json");
    const original = fs.readFileSync(registryPath, "utf8");
    const hosts: Array<[string, SessionHost]> = [["session", new SessionHost("session", source)]];
    fs.writeFileSync(registryPath, "broken");
    const snapshot = buildSessionListItems(hosts);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.sessionKey).toBe("session");
    expect(snapshot[0]?.projectId).toBeUndefined();
    fs.writeFileSync(registryPath, original);
    expect(buildSessionListItems(hosts)[0]?.projectId).toBe(workspace.id);
  });
});
