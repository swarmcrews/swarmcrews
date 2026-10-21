import { fstatSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadBrowserPolicy, browserPolicySchema } from "./policy.ts";
// Metadata at the filesystem boundary simulates /etc policy installation without sudo.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, fstatSync: vi.fn(actual.fstatSync) };
});
const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
function protectedFixture() {
  vi.mocked(fstatSync).mockImplementation(((fd: number) => {
    const stat = actualFs.fstatSync(fd);
    return Object.assign(stat, { uid: 0, mode: stat.isDirectory() ? stat.mode & ~0o022 : stat.mode });
  }) as typeof fstatSync);
}
const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "browser-policy-")); dirs.push(dir);
  const project = join(dir, "project"); mkdirSync(project);
  const policy = { version: 1, maxConcurrent: 2, runners: [{ id: "local", image: `localhost/tests@sha256:${"a".repeat(64)}`, grants: [{ sessionKey: "leader", projectPath: project, worktrees: [project], suites: ["smoke"], expiresAt: Date.now() + 60000, manage: true }] }] };
  return { dir, project, policy };
}
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.mocked(fstatSync).mockImplementation(actualFs.fstatSync); });
it("is disabled without operator policy", () => expect(loadBrowserPolicy(undefined).runners).toEqual([]));
it("requires pinned images, bounded limits and strict inputs", () => {
  const { policy } = fixture();
  expect(browserPolicySchema.parse(policy).runners[0]?.maxConcurrent).toBe(1);
  expect(() => browserPolicySchema.parse({ ...policy, command: "bash" })).toThrow();
  expect(() => browserPolicySchema.parse({ ...policy, maxConcurrent: 1000 })).toThrow();
  expect(() => browserPolicySchema.parse({ ...policy, runners: [{ ...policy.runners[0], image: "latest" }] })).toThrow();
});
it.skipIf(process.platform !== "linux")("rejects writable, oversized, duplicate and workspace-owned policy files", () => {
  protectedFixture();
  const { dir, project, policy } = fixture(); const file = join(dir, "policy.json");
  writeFileSync(file, JSON.stringify(policy), { mode: 0o600 });
  expect(loadBrowserPolicy(file).runners).toHaveLength(1);
  chmodSync(file, 0o666); expect(() => loadBrowserPolicy(file)).toThrow(); chmodSync(file, 0o600);
  writeFileSync(file, JSON.stringify({ ...policy, runners: [...policy.runners, ...policy.runners] }));
  expect(() => loadBrowserPolicy(file)).toThrow();
  writeFileSync(file, " ".repeat(262145)); expect(() => loadBrowserPolicy(file)).toThrow();
  const inside = join(project, "policy.json"); writeFileSync(inside, JSON.stringify(policy), { mode: 0o600 });
  expect(() => loadBrowserPolicy(inside)).toThrow();
});
it("rejects a same-UID mode-0600 policy that a host-native agent could rewrite", () => {
  const { dir, policy } = fixture(); const file = join(dir, "policy.json");
  writeFileSync(file, JSON.stringify(policy), { mode: 0o600 });
  expect(() => loadBrowserPolicy(file)).toThrow();
});
it("accepts bounded literal root exclusions, not paths, traversal or glob rules", () => {
  const { policy } = fixture();
  const parse = (sourceExclusions: string[]) => browserPolicySchema.parse({ ...policy, runners: [{ ...policy.runners[0], sourceExclusions }] });
  expect(parse(["artifacts", "build", ".cache"]).runners[0]?.sourceExclusions).toEqual(["artifacts", "build", ".cache"]);
  for (const value of [".", "..", "src/fixtures", "../secret", "*.log", "", "nested\\path", "bad\0name"]) expect(() => parse([value])).toThrow();
  expect(() => parse(Array.from({ length: 33 }, (_, i) => `output-${i}`))).toThrow();
});
