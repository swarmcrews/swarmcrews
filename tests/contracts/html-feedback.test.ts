import { describe, expect, it } from "vitest";
import { htmlArtifactComponentSchema } from "../../shared/render-artifacts.ts";
import { createRenderToolsForLeader } from "../../server/render-tools.ts";
import type { WebSocketServer } from "ws";
import { createBus } from "../../server/bus.ts";

describe('HTML feedback dashboard contract', () => {
  it('validates bounded agent claims without allowing them to set user verification', () => {
    const result = htmlArtifactComponentSchema.parse({ id: 'review', type: 'html-artifact', html: '<p>Test</p>', feedbackResponses: [{ id: 'F01', summary: 'Adjusted spacing', verified: true }] });
    expect(result.feedbackResponses).toEqual([{ id: 'F01', summary: 'Adjusted spacing' }]);
    expect(htmlArtifactComponentSchema.safeParse({ ...result, feedbackResponses: [{ id: 'F01', summary: 'x'.repeat(2001) }] }).success).toBe(false);
  });
  it('rejects malformed patches atomically so persisted dashboards remain syncable', async () => {
    const { toolDefs, renderState } = createRenderToolsForLeader({ leaderSessionKey: 'patch-session', bus: createBus({ clients: new Set() } as unknown as WebSocketServer) });
    await toolDefs.find(t => t.name === 'render_set')!.handler({ components: [{ id: 'review', type: 'html-artifact', html: '<p>Safe</p>' }] });
    const before = JSON.stringify(renderState);
    await expect(toolDefs.find(t => t.name === 'render_patch')!.handler({ updates: [
      { id: 'review', title: 'Must not partially apply' },
      { id: 'review', feedbackResponses: [{ id: 'F01', summary: 'x'.repeat(2001) }] },
    ] })).rejects.toThrow();
    expect(JSON.stringify(renderState)).toBe(before);
    await toolDefs.find(t => t.name === 'render_patch')!.handler({ updates: [{ id: 'review', feedbackResponses: [{ id: 'F01', summary: 'Fixed' }] }] });
    expect(htmlArtifactComponentSchema.safeParse(renderState.components[0]).success).toBe(true);
  });
  it('advertises the review loop and preserves responses through set while sanitizing HTML', async () => {
    const { toolDefs, renderState } = createRenderToolsForLeader({ leaderSessionKey: 'review-session', bus: createBus({ clients: new Set() } as unknown as WebSocketServer) });
    expect(toolDefs.find(t => t.name === 'publish_html')?.description).toContain('feedbackResponses');
    await toolDefs.find(t => t.name === 'render_set')!.handler({ components: [{ id: 'review', type: 'html-artifact', html: '<script>bad()</script><p>Safe</p>', feedbackResponses: [{ id: 'F01', summary: 'Adjusted spacing' }] }] });
    expect(renderState.components[0]).toMatchObject({ feedbackResponses: [{ id: 'F01', summary: 'Adjusted spacing' }] });
    expect((renderState.components[0] as { html: string }).html).not.toContain('<script>');
  });
});
