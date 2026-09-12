import { beforeEach, expect, it } from "vitest";
import { clearLegacyPreference, readBrandPreference } from "./brand-storage.ts";

beforeEach(() => localStorage.clear());

it.each(["view", "debug-mode", "feature-flags"])("migrates the existing %s preference once", (name) => {
  localStorage.setItem(`minions:${name}`, "saved");
  expect(readBrandPreference(localStorage, `swarmcrews:${name}`)).toBe("saved");
  expect(localStorage.getItem(`swarmcrews:${name}`)).toBe("saved");
  expect(localStorage.getItem(`minions:${name}`)).toBeNull();
});

it("prefers new values and clears legacy values so resets cannot resurrect them", () => {
  localStorage.setItem("minions:debug-mode", "1");
  localStorage.setItem("swarmcrews:debug-mode", "0");
  expect(readBrandPreference(localStorage, "swarmcrews:debug-mode")).toBe("0");
  clearLegacyPreference(localStorage, "swarmcrews:debug-mode");
  localStorage.removeItem("swarmcrews:debug-mode");
  expect(readBrandPreference(localStorage, "swarmcrews:debug-mode")).toBeNull();
});
