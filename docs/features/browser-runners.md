# Isolated browser runners

Browser automation sometimes fails inside an agent's execution sandbox even when Chromium is launched with `--no-sandbox`. Swarmcrews provides a separate, **disabled-by-default** browser test capability for leaders and minions. It does not change their ordinary filesystem or approval policies.

This first version runs the fixed `pnpm test:smoke` and `pnpm test:e2e` suites. It is not an interactive browser, arbitrary shell service, remote CDP endpoint or general network proxy. It returns bounded test logs and snapshot identity; screenshots, videos and traces are not exported from the container in this version.

## Security boundary

- A local **rootless Podman** process runs the tests, using a pinned, preinstalled image. Linux, cgroup v2 and delegated CPU, memory and PID controllers are required. There is no Docker daemon socket and no host-execution fallback.
- The container has no external network, published ports, inherited host credentials, writable host mounts, extra capabilities or privilege escalation. The broker explicitly selects the non-root server UID/GID as well as `--userns=keep-id`, so an image's `USER root` cannot override the runtime identity. Chromium and its local test webserver can communicate over container-local loopback. Podman's default seccomp confinement remains enabled.
- Tests execute repository-controlled code. A fixed suite name is not a security boundary; the container is. Keep the host kernel and Podman updated. This is not a VM-grade isolation guarantee against hostile kernel exploits.
- The source root is pinned with descriptor-relative, no-symlink traversal before asynchronous preflight, then copied into a bounded snapshot without running Git, package scripts or hooks on the host. Included symlinks, hardlinks and special files are rejected. Dependencies, Git metadata, `.scratch`, `.minions`, `.swarmcrews`, `.npmrc`, `.yarnrc`, `.env*`, temporary `.minions-mcp-launch-*` / `.swarmcrews-*` state, and previous Playwright output directories are excluded. Root-only local runtime/recovery directories `.run`, `.canvas-worktrees`, `.context`, `.recovery`, `.stryker-tmp`, and `__dag_verify__` are also excluded before opening their contents. This is **not a general secret scanner**: grant only worktrees whose remaining content the recipient may read.
- A source snapshot is mounted read-only and copied into size-limited container tmpfs. Dependencies come from the read-only image: `/work/node_modules` is a writable directory containing package links plus links to the image's `.bin` and `.pnpm` runtime layout, not a link to the entire dependency root. Vite's `.vite-temp` config bundles and `.vite` optimizer cache are created locally under `/work/node_modules` and count against the existing workspace tmpfs limit; image caches are not linked. No additional mount or writable image layer is needed. Test writes do not modify the actual worktree. A SHA-256 manifest identifies the exact copied paths/content; concurrent editing can yield a mixed snapshot, so stop edits before verification and rerun after changes.
- Run one Swarmcrews browser broker per dedicated rootless OS account. Do not expose that account's Podman control or policy files to sandboxed agents. An agent with unrestricted access as the server's OS user can bypass application policy; this feature cannot constrain such access.

## Operator setup

No policy, image or host permissions are installed automatically. On the **machine hosting Swarmcrews**, install rootless Podman at `/usr/bin/podman` and verify its cgroup delegation. The machine running the browser UI need not have Podman.

Build a dependency image using a trusted Playwright base image matching the repository's `@playwright/test` version. Choose and verify the base digest yourself. Build-time dependency installation needs network access; runtime tests do not.

```bash
# Run as the dedicated, non-root server account, outside any agent sandbox.
context=$(mktemp -d)
cp scripts/browser-runner.Containerfile "$context/Containerfile"
cp package.json pnpm-lock.yaml "$context/"
podman build --build-arg PLAYWRIGHT_IMAGE='mcr.microsoft.com/playwright@sha256:<verified-digest>' \
  -t localhost/swarm-browser "$context"
rm -rf "$context"
podman image inspect localhost/swarm-browser --format '{{.Id}}'
```

Use the returned immutable `sha256:...` image ID, or an already-pulled `registry/image@sha256:...` digest, in the policy. Images are never pulled automatically. Rebuild and update the policy when dependencies or the Playwright version change. The image must contain `pnpm`, a compatible Node runtime, browsers/system libraries, and dependencies at `/opt/browser-runner/node_modules`.

Store the policy outside **all** permitted projects/worktrees. The file **and every ancestor directory must be root-owned and not writable by group/others**. Symlinks are rejected throughout the policy path. Server-user-owned mode-0600 files are deliberately rejected: an unsandboxed agent running as that same user could rewrite them. Use a protected path such as `/etc/swarmcrews/browser-runners.json`; never a home directory, project, or `/tmp`.

After preparing and reviewing the JSON, an operator can install it with:

```bash
sudo install -d -o root -g root -m 0755 /etc/swarmcrews
sudo install -o root -g root -m 0644 browser-policy.json /etc/swarmcrews/browser-runners.json
```

The Swarmcrews server itself still runs **without root privileges**. Root ownership protects application policy, not the whole server against unrestricted same-UID native execution: use OS-confined or separate-UID agents when native processes are untrusted.

Example (replace paths, session keys, digest, and the expiry with real values):

```json
{
  "version": 1,
  "maxConcurrent": 2,
  "runners": [{
    "id": "local-browser",
    "image": "sha256:<64-hex-image-id>",
    "maxConcurrent": 2,
    "timeoutSeconds": 300,
    "memoryMb": 2048,
    "cpus": 2,
    "pids": 256,
    "workspaceMb": 256,
    "sourceExclusions": ["dist", "coverage"],
    "grants": [{
      "sessionKey": "<leader-session-key>",
      "projectPath": "/srv/projects/example",
      "worktrees": ["/srv/projects/example", "/srv/worktrees/example-review"],
      "suites": ["smoke", "e2e"],
      "expiresAt": 1893456000000,
      "manage": true
    }]
  }]
}
```

`expiresAt` is epoch milliseconds; use a short operational lease rather than the illustrative date above. Paths must be canonical existing directories. `projectPath` is the original project; `worktrees` is an explicit list of execution directories, not glob patterns or recursive roots. A generated minion worktree must be added explicitly before access is possible.

Set `SWARMCREWS_BROWSER_POLICY=/etc/swarmcrews/browser-runners.json` in the **server process environment**, then start Swarmcrews. Policy edits are read on every operation and checked against active runs approximately once per second. Replace the JSON atomically; invalid or unavailable policy cancels active authority rather than keeping stale grants. An absent environment variable disables access.

## Assigning and restricting access

Tools use the server's session identity and worktree; callers cannot supply an alternate project, execution path, image, shell command, flags or environment.

- `mcp__browser-runner__list_runners`: an availability report with `status`, an actionable `message`, `preflight: "not_run"`, caller-only `authorizationRequest`, and a `runners` array. Authorized entries include resources, limits, permitted suites, exact worktree scope, expiry, management rights and accessible run IDs. See diagnostics below; this result is an object, not a bare array.
- `run_tests { runnerId, suite }`: runs synchronously to completion. Busy resources reject immediately; nothing is queued.
- `get_run { runId, offset? }`: status and a bounded log page.
- `cancel_run { runId }`: stops an owned run; a scoped manager may also cancel managed runs.
- `grant_access { runnerId, sessionKey, suites, ttlSeconds, worktrees? }`: an operator-authorized manager delegates a subset of suites for at most an hour, never beyond its own expiry. Optional worktrees narrow the parent's approved set. Delegates cannot manage or redelegate.
- `revoke_access { runnerId, sessionKey }`: revokes a delegation issued by that manager and cancels its active work. Agents cannot remove or change operator grants; edit the policy for those.

There is no automatic parent/child inheritance. Multiple leaders can receive direct grants; their minions can receive explicit direct or delegated grants. A session with a run grant reads/cancels only its own runs. Managers can read/cancel runs in their project, worktree and suite scope. Do not grant management rights to sessions that should not see other sessions' test output. Changing/removing an issuer's operator grant invalidates its delegations. Delegations and history are in memory and disappear on server restart.

The tool inventory is harness-neutral, including graph minions. Existing exact tool allowlists still restrict it. Planning invocations cannot run, cancel or manage browser resources. Missing access or infrastructure failure means browser verification is **blocked**, not passed. Do not work around it using unsandboxed shell commands or `--no-sandbox`.

## Availability diagnostics

Tools being present in a session means the capability is installed, **not** that a runner is configured or the session has permission. `list_runners` performs no container commands and does not establish backend health.

| Status | Meaning / next action |
|---|---|
| `not_configured` | No runners are configured: the server environment lacks `SWARMCREWS_BROWSER_POLICY`, or its valid policy contains no runners. Install a protected policy and set the variable in the server launcher. Environment changes require a restart. |
| `policy_unavailable` | Policy cannot be read or validated. Operator: check the path, JSON/schema, protected root ownership/ancestry, canonical directories and filesystem permissions. Raw errors, policy contents and paths are not exposed. All execution remains denied. |
| `workspace_unavailable` | The caller's project or execution directory cannot be canonicalized. Restore it or create a session in an existing directory. No grant-request identity is fabricated. |
| `no_session_access` | A policy exists but no current direct/delegated grant matches this caller. Check session identity, original project, exact worktree and expiry. This does not reveal which runners or grants exist. |
| `available` | At least one grant matches. Inspect the returned scopes and quarantine state, then run an authorized smoke suite. Podman/image/cgroup checks occur at execution, not discovery. |

For resolvable caller directories, `authorizationRequest` includes only this caller's `sessionKey`, canonical `projectPath`, and `worktrees: [currentExecutionDirectory]`. It lets an operator prepare an exact grant without guessing IDs. It is not a grant and never includes another session's identity or unmatched resources. Add suites and an explicit expiry after review; `manage` should normally remain false. Only an already-authorized manager may use `grant_access`.

## Which policies can be configured?

There are no permissive/host-browser presets. All configured runners share the same fixed isolation boundary. The operator JSON controls:

- **Identity/access:** exact session, original project and execution-worktree allowlist, smoke/e2e suites, expiry, and optional manager delegation authority. Delegation lasts at most one hour and cannot outlive its parent.
- **Source selection:** optional `sourceExclusions`, up to 32 literal worktree-root entry names (1–128 ASCII letters, digits, dots, underscores or hyphens; not `.` or `..`). These are operator-owned, not tool arguments. They cannot contain paths or glob expressions. An exclusion such as `artifacts` omits only the root entry: `tests/fixtures/artifacts` remains included. Generic folders such as `build`, `designs` and `artifacts` stay included unless explicitly selected; review exclusions because they change what a test can exercise. Authorized discovery reports them, and changing them cancels active runs. `.gitignore` is not interpreted: dirty/untracked source remains included unless an explicit exclusion applies. No source limit or symlink guard is relaxed.
- **Runtime image:** an immutable, already-present image digest; automatic pulls and arbitrary commands are prohibited.
- **Capacity:** 1–8 jobs globally, 1–4 per runner, one active job per session; busy requests are not queued.
- **Limits:** 10–900 seconds; 512–8192 MiB memory; 0.25–4 CPUs; 64–1024 PIDs; 64–1024 MiB workspace tmpfs. Defaults are described below and enforced by `policy.ts`.

Policy cannot enable external network access, host browser execution, writable host mounts, privileged containers, arbitrary test commands, interactive browsing, or screenshot export. Agent sandbox/approval preferences and MCP tool selection do not override this boundary.

## Is setup worthwhile?

Use this runner for reproducible agent-driven smoke/E2E checks with exact source evidence, resource limits and no host credentials. Rootless Podman can coexist with Docker; no Docker socket is used. Expect disk space for the Playwright/dependency image and rebuilds when dependencies change. The server's rootless OS account must own the image; building it with `sudo podman` puts it in the wrong image store.

This version does **not** finish an aesthetic-review workflow on its own: it returns logs, not screenshots or an interactive browser. It can verify layout/contrast assertions; actual visual review still needs separately supplied images or a deliberately implemented, bounded artifact-export capability.

On Arch/Omarchy, install the distribution's `podman` package as an operator (for example, `omarchy pkg add podman` on installations exposing that command). Do not substitute Docker, launch host Chromium, or change policy security checks to work around missing privileges. After installation, run `podman info --format=json` as the non-root server account and verify `host.security.rootless`, cgroup v2 and CPU/memory/PID delegation. Follow **Operator setup** for the pinned image and root-owned policy, then perform **Validation** before relying on live enforcement. No package installation, image or grant is provisioned automatically by this feature.

## Resource management and recovery

Defaults are two jobs globally and one per runner; the hard configuration maxima are eight globally and four per runner. Each session may hold only one job at a time. All runners share this process-wide accounting; separate runner IDs do not bypass it.

Each run has a 10–900 second wall-clock budget, bounded CPU/memory/PIDs, 64 MiB temporary storage, 256 MiB shared memory and configurable 64–1024 MiB work tmpfs. Memory limits also account for tmpfs consumption. Source snapshots are limited to 64 MiB total, 16 MiB per file, 10,000 entries and 40 directory levels. Logs retain at most 65,536 characters per run, returned in 4,096-character pages. At most 64 run records are retained, for up to 15 minutes; older completed records may be evicted earlier. At most 128 delegated grants are retained.

Abort, timeout, cancellation and policy revocation stop the container. Capacity is held until cleanup completes, not merely until the CLI exits. Unconfirmed cleanup quarantines the runner and retains its capacity lease; it cannot report success. Investigate rather than retrying repeatedly.

Podman's container timeout bounds runtime if the server dies. Startup refuses to execute new jobs while containers with `io.swarmcrews.browser-runner=1` remain from an earlier broker. After a crash or quarantine, an operator should:

1. Inspect `podman ps -a --filter label=io.swarmcrews.browser-runner=1` under the server account.
2. Stop/remove the identified containers after confirming they belong to the stopped broker.
3. Remove that broker's leftover `swarm-browser-*` snapshot directories from its temporary directory, after confirming no runs use them.
4. Restart Swarmcrews to clear quarantine and re-establish any required delegations.

Normal completion removes the container and source snapshot. Runtime artifacts inside the container are discarded. A failed preflight is cached until restart; repair Podman/cgroup setup and reconcile leftovers before restarting.

## Validation

Unit/contract tests exercise authorization, delegation, revocation, source isolation, resource accounting, lifecycle decisions and tool schemas. They do not prove live kernel enforcement. On the target host, run the opt-in backend integration test with a built image before relying on this feature:

```bash
SWARMCREWS_BROWSER_TEST_IMAGE='sha256:<image-id>' \
  pnpm exec vitest run server/browser-runner/live.integration.test.ts
```

The test executes repository-controlled fixture code inside the container to check real Vite TypeScript/ESM config loading and dependency optimization, writable container-local caches with read-only image dependencies, browser launch, loopback sockets, non-root identity, cgroup limits, lack of external networking, source-mount read-only behavior and cleanup. The ordinary `server/browser-runner/bootstrap.test.ts` regression also executes the generated bootstrap and loads the repository's real Vite config against a read-only dependency fixture without launching a container or browser; it does not establish live kernel enforcement. Only the opt-in integration test requires the configured Podman prerequisites; it intentionally performs no host fallback.
