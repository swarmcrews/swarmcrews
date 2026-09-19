import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRepositoryPath } from "./repository-paths.ts";

describe("normalizeRepositoryPath", () => {
  it("normalizes quoted, tiled POSIX paths while retaining POSIX names", () => {
    expect(normalizeRepositoryPath(" '/tmp/hello world/é' ", { platform: "posix" })).toBe("/tmp/hello world/é");
    expect(normalizeRepositoryPath("~/repo", { platform: "posix", homedir: "/users/alice" })).toBe("/users/alice/repo");
    expect(normalizeRepositoryPath("/Volumes/Work/repo", { platform: "posix" })).toBe("/Volumes/Work/repo");
  });

  it("does not reinterpret Windows syntax as POSIX relative input", () => {
    for (const value of ["C:\\repo", "C:repo", "\\\\server\\share\\repo", "\\repo"]) {
      expect(normalizeRepositoryPath(value, { platform: "posix" })).toBeNull();
    }
  });

  it("handles Windows drive, UNC, separators and tilde without host Windows", () => {
    expect(normalizeRepositoryPath("'C:/Users/Alice/mixed\\repo'", { platform: "win32" }))
      .toBe("C:\\Users\\Alice\\mixed\\repo");
    expect(normalizeRepositoryPath("\\\\server\\share\\repo", { platform: "win32" }))
      .toBe("\\\\server\\share\\repo");
    expect(normalizeRepositoryPath("~\\repo", { platform: "win32", homedir: "D:\\Users\\Alice" }))
      .toBe("D:\\Users\\Alice\\repo");
    expect(path.win32.isAbsolute(normalizeRepositoryPath("C:/repo", { platform: "win32" })!)).toBe(true);
  });

  it("rejects ambiguous Windows roots, device names and alternate streams", () => {
    for (const value of ["C:repo", "\\repo", "\\\\?\\C:\\repo", "\\\\.\\C:\\repo", "C:\\repo:stream", "C:\\repo\\file:stream"]) {
      expect(normalizeRepositoryPath(value, { platform: "win32" })).toBeNull();
    }
  });
});
