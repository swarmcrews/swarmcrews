import { describe, expect, it } from "vitest";
import { projectErrorMessage } from "./project-error.ts";

describe("projectErrorMessage", () => {
  it("distinguishes disconnected, unavailable and rejected requests", () => {
    expect(projectErrorMessage(new TypeError("Failed to fetch"))).toContain("Couldn’t reach the server");
    expect(projectErrorMessage(new Error("API error 404: <html>missing</html>"))).toContain("project is unavailable");
    expect(projectErrorMessage(new Error('API error 403: {"error":"Permission denied"}'))).toBe("Permission denied (HTTP 403)");
  });
  it("does not print a proxy HTML document as inline recovery copy", () => {
    expect(projectErrorMessage(new Error("API error 500: <html>server stack</html>"))).toBe("The server couldn’t complete this request. Check the server and retry. (HTTP 500)");
  });
  it("preserves non-API reasons including literal unbroken server values", () => {
    expect(projectErrorMessage(new Error("path_".repeat(50)))).toBe("path_".repeat(50));
    expect(projectErrorMessage("Rejected")).toBe("Rejected");
  });
});
