import { describe, expect, it } from "vitest";
import { normalizeRepositoryPath } from "./repository-paths.ts";

describe("repository path portability regressions", () => {
  it.each([
    "/home/alex/O'Brien/project",
    '/Volumes/Work/a "quoted" folder',
    "/home/alex/a\\b",
  ])("preserves POSIX filename characters in %s", (value) => {
    expect(normalizeRepositoryPath(value, { platform: "posix" })).toBe(value);
  });

  it.each([
    "C:", "C:relative", "/relative", "\\relative", "\\\\server",
    "//?/C:/repo", "//./C:/repo", "\\\\?\\UNC\\server\\share\\repo",
    "C:/repo:stream", "~/repo:stream", "C:/Repos/NUL", "C:/Repos/con.txt",
    "C:/Repos/COM1", "C:/Repos/LPT¹", "C:/Repos/ambiguous.", "C:/Repos/ambiguous /child",
  ])("rejects ambiguous or special Windows input %s", (value) => {
    expect(normalizeRepositoryPath(value, { platform: "win32", homedir: "C:\\Users\\Alex" })).toBeNull();
  });

  it.each([
    ["c:/Repos/../Repos/Résumé project", "c:\\Repos\\Résumé project"],
    ["//server/share/team\\repo", "\\\\server\\share\\team\\repo"],
    ["C:/Users/O'Brien/repo", "C:\\Users\\O'Brien\\repo"],
    ['"C:/Users/Alex/my app"', "C:\\Users\\Alex\\my app"],
    ["~/Repos/我的项目", "D:\\Users\\Alex\\Repos\\我的项目"],
  ])("normalizes explicit Windows input %s", (value, expected) => {
    expect(normalizeRepositoryPath(value, { platform: "win32", homedir: "D:\\Users\\Alex" })).toBe(expected);
  });
});
