# Swarmcrews naming and compatibility

The application is **Swarmcrews**. The Leader and Minion agent roles keep their
names. The lowercase wordmark pairs the existing Leader crown/circle geometry
with amber **swarm** and light **crews**. SVG paths are outlined from the bundled
DM Sans typeface (bold and regular); no installed fonts or external requests are
required. `public/brand/` contains the mark and wordmark, and
`assets/swarmcrews-logo.svg` is the standalone dark-background lockup. The app's
`Brand` component adapts the light lettering to the selected theme and uses just
the mark in narrow project headers.

## Workspace home

Home selection, in order:

1. Explicit `SWARMCREWS_HOME`.
2. Legacy `MINIONS_HOME`, if the new variable is unset.
3. `~/.swarmcrews`, if it exists.
4. `~/.minions`, if it exists and the new home does not.
5. `~/.swarmcrews` for a fresh installation.

No directories are moved, merged, or deleted automatically. Existing repository
`.minions` sidecars continue through the existing workspace-registration migration.
If both global directories exist, select the desired collection explicitly.
To relocate state, stop the app, back up the complete selected home, and move it
as a unit or point `SWARMCREWS_HOME` at it. Do not move individual databases or
rewrite the workspace registry.

## Settings and saved data

The new environment names take precedence; these old names remain accepted:

| Preferred name | Legacy alias |
| --- | --- |
| `SWARMCREWS_HOME` | `MINIONS_HOME` |
| `SWARMCREWS_SERVER_DB` | `MINIONS_SERVER_DB` |
| `SWARMCREWS_ARTIFACTS_DIR` | `MINIONS_ARTIFACTS_DIR` |
| `SWARMCREWS_LOG_LEVEL` | `MINIONS_LOG_LEVEL` |
| `SWARMCREWS_LOG_PRIVATE` | `MINIONS_LOG_PRIVATE` |
| `SWARMCREWS_LOG_STACKS` | `MINIONS_LOG_STACKS` |
| `SWARMCREWS_NO_OPEN` | `MINIONS_NO_OPEN` |
| `SWARMCREWS_LAUNCH_LOG` | `MINIONS_LAUNCH_LOG` |
| `SWARMCREWS_TEST_HARNESS` | `MINIONS_TEST_HARNESS` |
| `VITE_SWARMCREWS_LOG_LEVEL` | `VITE_MINIONS_LOG_LEVEL` |

Browser view, debug, and feature preferences migrate from `minions:*` to
`swarmcrews:*` on first read. New values win. Resetting a preference removes its
legacy value too. New skill icons use `swarmcrews:*`; saved `minions:*` icons
remain readable and selectable. Skill exports identify as `swarmcrews-skills`,
while existing bundles and bare-array imports remain supported. History links
accept the old authentication cookie; newly issued cookies use the new name.

New launcher files are `.run/swarmcrews.pid` and `.run/swarmcrews.log`. A live
legacy `.run/minions.pid` remains discoverable by start/status/stop/restart;
starting again after stopping it writes the new filenames.

New integration/contribution Git refs use `swarmcrews/`. Existing refs are read
from persisted records, and the historical schema migration retains its original
prefix. Existing deterministic work-item identifiers also retain their hash
namespace so retrying a request cannot create a second identity.

The evaluation package is `@swarmcrews/agent-evals`. The role-based adapter IDs
`minion-single` and `minion-graph`, persisted evaluation usage tags, and existing
handle storage paths remain compatible with saved runs.

Repository URLs still point at `hipsterusername/minions`, the configured source
repository. Installation commands clone it into a local `swarmcrews` directory.
Renaming or publishing an upstream repository is a separate operation. Historical
audits and plans retain the names used when written.
