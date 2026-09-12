# Getting Started screenshots

The [Getting Started guide](../getting-started.md) embeds six PNG screenshots
under `docs/images/`. They are captured in Chromium from the application's real
React components and styles, supplied with invented, deterministic sample data.
They are component scenes, not evidence of a live provider run. The surrounding
heading and arrangement are documentation framing, not additional app controls.

The projects, launch, minions, and dashboard PNGs have a targeted Swarmcrews
branding update: the checked-in SVG mark and wordmark are composited into the
existing captures, with old product and sample-project labels corrected. These
are edited documentation illustrations, not fresh browser captures. The graph
images did not contain the old product branding. The capture sources also use
the SVG brand so a future full capture retains it.

## Regenerate

From the repository root, after `pnpm install`:

```bash
pnpm exec playwright install chromium
node docs/screenshots/capture.mjs
```

The script starts a temporary loopback Vite server on a free port and closes it
when capture finishes. It does not start the Swarmcrews backend or an agent, mutate
project state, or use provider credentials. API and WebSocket boundaries are
intercepted, and external network requests from the browser are blocked. There
is no need to stop an existing Swarmcrews service.

`scenes.tsx` owns sample content. Product layout and behavior come from imports
under `src/`; `style.css` only frames the component scenes. The capture uses
Daybook at 1440 × 960, with reduced motion and local bundled fonts. Dashboard
fixtures are checked against the production component schema. Page exceptions
fail the capture.

| Image | Story beat | Product surface |
|---|---|---|
| `getting-started-projects.png` | Open the practice repository | Projects page |
| `getting-started-launch.png` | Enter an outcome and select isolation | Activity launch form |
| `getting-started-minions.png` | Watch separate file owners work | Task plan and Minion cards |
| `getting-started-graph.png` | Understand fork/join dependencies | Graph inspector, Flow |
| `getting-started-graph-detail.png` | Inspect the final task's requirements | Graph inspector, selected task |
| `getting-started-dashboard.png` | Read results and answer a pending question | Dashboard surface |

After capture, inspect every image for clipping, missing styles, invalid sample
data, and readable text. Check the guide's captions and UI labels whenever a
product component changes. Keep images local and retain descriptive alt text;
the guide's instructions must remain usable without seeing the images.
