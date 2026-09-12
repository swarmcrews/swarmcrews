import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveSwarmcrewsHome } from "./runtime-home.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcrews-home-test-"));
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

it("uses a fresh Swarmcrews home without creating directories on read", () => {
  expect(resolveSwarmcrewsHome({}, home)).toBe(path.join(home, ".swarmcrews"));
  expect(fs.existsSync(path.join(home, ".swarmcrews"))).toBe(false);
});

it("finds legacy state and gives an existing new home precedence without moving data", () => {
  const legacy = path.join(home, ".minions");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "sentinel"), "saved sessions");
  expect(resolveSwarmcrewsHome({}, home)).toBe(legacy);
  fs.mkdirSync(path.join(home, ".swarmcrews"));
  expect(resolveSwarmcrewsHome({}, home)).toBe(path.join(home, ".swarmcrews"));
  expect(fs.readFileSync(path.join(legacy, "sentinel"), "utf8")).toBe("saved sessions");
});

it("honors explicit new and legacy overrides ahead of default homes", () => {
  expect(resolveSwarmcrewsHome({ MINIONS_HOME: "/tmp/old" }, home)).toBe(path.resolve("/tmp/old"));
  expect(resolveSwarmcrewsHome({ SWARMCREWS_HOME: "/tmp/new", MINIONS_HOME: "/tmp/old" }, home))
    .toBe(path.resolve("/tmp/new"));
});
