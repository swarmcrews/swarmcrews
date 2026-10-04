import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewFiles, ReviewIdentity } from "./ReviewEvidence.tsx";
import type { ReviewDiff } from "../../../shared/review-diff.ts";
const long = "long/unbroken/" + "path".repeat(90);
const diff: ReviewDiff = { filesChanged: 4, insertions: 1, deletions: 1, commits: [], branch: "main", files: [
  { file: long, previousFile: "old/" + long, status: "renamed", insertions: 0, deletions: 0, patch: { state: "text", text: "rename from old\nrename to new" } },
  { file: "deleted.txt", status: "deleted", insertions: 0, deletions: 1, patch: { state: "text", text: "@@ -1 +0 @@\n-deleted" } },
  { file: "binary.bin", status: "added", insertions: 0, deletions: 0, patch: { state: "binary" } },
  { file: "large.txt", status: "modified", insertions: 1, deletions: 0, patch: { state: "large", reason: "Patch exceeds 64 KiB." } },
] };
describe("shared mobile/desktop review component", () => {
  it("exposes full rename paths, deletion patches and explicit binary/large states", () => {
    render(<ReviewFiles diff={diff} />);
    for (const file of diff.files) fireEvent.click(screen.getByText(file.file, { selector: ".review-file__path" }));
    expect(screen.getByText("old/" + long)).toHaveTextContent("old/" + long);
    expect(screen.getByText("-deleted")).toBeVisible();
    expect(screen.getByText("Binary file")).toBeVisible();
    expect(screen.getByText("Large file / patch omitted")).toBeVisible();
    expect(screen.getByLabelText("Patch for deleted.txt")).toHaveAttribute("tabindex", "0");
  });
  it("does not invent revision or approved-contribution identity for old summaries", () => {
    render(<ReviewIdentity diff={diff} sessionKey="requested-run" loading={false} error={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("snapshot run not recorded");
    expect(screen.getByRole("status")).toHaveTextContent("Snapshot identity not recorded");
  });
});
