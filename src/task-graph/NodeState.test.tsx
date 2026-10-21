import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createGraphFixture } from "./fixtures.ts";
import { NodeState } from "./NodeState.tsx";
import { whyNotRunning } from "./model.ts";

describe("scheduler-owned waiting state",()=>{
  it("shows a deadline without implying an active attempt or guaranteed launch",()=>{
    const node={...createGraphFixture(1).nodes[0]!,currentAttempt:null,
      scheduledReleaseAt:"2026-08-14T12:35:00.000Z",blocker:{category:"delay" as const,explanation:"dependency delay"}};
    const {rerender}=render(<NodeState node={node}/>);
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText(/^Release /)).toHaveAttribute("datetime",node.scheduledReleaseAt);
    expect(whyNotRunning(node)).toContain("normal scheduling constraints still apply");
    rerender(<NodeState node={{...node,scheduledReleaseAt:undefined,blocker:null}}/>);
    expect(screen.queryByText(/^Release /)).not.toBeInTheDocument();
  });
});
