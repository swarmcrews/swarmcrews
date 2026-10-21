import { expect, it } from "vitest";
import { librarySummaryFreshness, libraryAckSchema, libraryMetadataPatchSchema } from "./index.ts";
it("distinguishes expiry/stale from unknown without inventing fresh quiet state", () => {
  expect(librarySummaryFreshness({ freshness: "fresh", expiresAt: "2026-01-01T00:00:00Z" }, 0)).toBe("fresh");
  expect(librarySummaryFreshness({ freshness: "fresh", expiresAt: "2026-01-01T00:00:00Z" }, Date.parse("2026-01-01T00:00:00Z"))).toBe("stale");
  expect(librarySummaryFreshness({ freshness: "unknown", expiresAt: "2099-01-01" }, 0)).toBe("unknown");
  expect(librarySummaryFreshness({ freshness: "fresh", expiresAt: "invalid" }, 0)).toBe("unknown");
});
it("rejects path edits and review actions masquerading as read acknowledgments", () => {
  expect(libraryMetadataPatchSchema.safeParse({ expectedRevision: 0, path: "/elsewhere" }).success).toBe(false);
  expect(libraryAckSchema.safeParse({ receipt: "receipt", events: [], approve: true }).success).toBe(false);
});
