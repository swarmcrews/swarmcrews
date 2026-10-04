# Guided installation

Swarmcrews has three native entrypoints and a shared, dependency-free terminal
wizard. Choose the path for the **computer that will run the agents**, not the
computer you use to open the browser.

These currently install **from source** and build locally. They are not prebuilt
binaries or a published package-manager command.

## Choose your operating system

From a checkout containing the installers:

| Host | Command |
|---|---|
| Linux (glibc, x64 / arm64) | `bash install/linux.sh` |
| macOS (Intel / Apple Silicon) | `bash install/macos.sh` |
| Windows (x64 / arm64) | `powershell -NoProfile -File .\install\windows.ps1` |

WSL uses the Linux installer inside WSL. Do not mix Windows Node/Git with a Linux
installation. Alpine/musl needs the [manual installation](../README.md#quick-start)
with a compatible runtime; this bootstrap does not provision a musl Node build.

### Without an existing checkout

Download the appropriate standalone script from the repository's `install/`
folder, inspect it, then run it in your terminal. It can obtain the rest of the
source after confirmation. For example, once the installer files are available
on the branch you choose:

```bash
# Linux; substitute macos.sh for macOS.
curl --fail --location https://raw.githubusercontent.com/hipsterusername/minions/main/install/linux.sh -o swarmcrews-install.sh
# Inspect swarmcrews-install.sh before running it.
bash swarmcrews-install.sh
```

On Windows, download [`windows.ps1`](../install/windows.ps1), inspect it, then run:

```powershell
powershell -NoProfile -File .\windows.ps1
```

If Windows blocks a downloaded script, review it and follow your organization's
script-signing policy. Setup does not change execution policy or bypass it.
Run in a normal terminal, **not as root or Administrator**. Avoid piping a
script directly into a shell: the wizard needs your terminal for confirmations.

Standalone installers use `main` by default and display the requested source
ref. To select a known tag or commit, set `SWARMCREWS_REF` before running. Download
the bootstrap from that same trusted revision too. This is an HTTPS source
workflow, not a signed-release trust guarantee. The app is installed at the
resolved commit and reruns do not silently pull newer code.

When launched from a checkout, the installer uses that checkout's **committed
HEAD**, not uncommitted changes. It installs into a separate empty directory;
it does not adopt or overwrite an existing developer checkout.

## What the installer does

1. **Checks the host.** Node must be >=22.12.0. A suitable existing runtime is
   reused; otherwise setup offers a private Node 22.22.0 runtime, verifies its
   archive against Node's HTTPS-hosted SHA-256 list, and leaves global Node alone.
2. **Checks Git.** Supported package-manager repairs require separate consent.
   On macOS without Homebrew, setup explains Apple's Command Line Tools path;
   it does not install Homebrew. Linux requires curl, tar and a SHA-256 utility.
3. **Reviews the plan.** Choose an empty application folder and one agent, or
   choose to configure an agent later. Review the exact source commit and paths.
4. **Installs application dependencies.** pnpm is provisioned privately at the
   version declared by the selected source. The frozen lockfile and repository
   lifecycle-script restrictions remain enforced. SQLite is opened and queried
   to check native compatibility. No blanket compiler installation is attempted.
5. **Connects an agent.** Existing harness readiness checks are reused. Setup can
   hand your terminal to an installed agent's official login. It never asks you
   to paste credentials into its own prompts and does not record login output.
   Missing third-party agents link to their official guides. Windows batch-only
   agent wrappers must be logged into separately, then rechecked.
6. **Builds, starts, and verifies.** The application stays loopback-only. Setup
   checks the frontend, backend API and WebSocket handshake, then offers to open
   your browser. A surviving process alone is not considered success.

There are no TUI packages to install. The terminal interface uses Node built-ins,
numbered keyboard choices, an amber Swarmcrews wordmark, and persistent progress
messages. It does not clear your scrollback or switch to a full-screen terminal.
`NO_COLOR=1`, redirected output and `TERM=dumb` disable ANSI styling.

## Options and diagnostics

```bash
node scripts/install/wizard.mjs --help
node scripts/install/wizard.mjs --check
node scripts/install/wizard.mjs --preview --platform linux
```

`--check` is a read-only host check; it does not claim to validate application
packages or agent credentials before installation. `--preview` shows a clearly
labelled sample of the six-stage interface; it changes nothing. Platform values
for preview are `linux`, `darwin`, and `win32`.

For unattended application setup from a local checkout with prerequisites ready:

```bash
node scripts/install/wizard.mjs --yes --dir "$HOME/swarmcrews" --agent later --skip-start
```

- `--yes` requires both `--dir` and `--agent`. It approves the application plan,
  **not system package installation, runtime provisioning or provider login**.
- `--agent`: `claude`, `codex`, `copilot`, `opencode`, `pi`, or `later`.
- `--skip-start`: install dependencies without building/starting or claiming
  application health.
- `--port N` / `--backend-port N`: choose distinct frontend/backend ports.
  Interactive setup offers a new port if another process is using the default.
  It never kills a foreign process to free a port.
- Set `SWARMCREWS_MANAGED_NODE=1` when invoking a platform bootstrap to select
  the private runtime, for example when the existing Node distribution lacks npm.

Exit codes: `0` = completed with the selected agent ready; `2` = application
setup completed but agent readiness is pending; `1` = an installation/check error;
`130` = cancelled. With `--skip-start`, completion means dependencies installed,
not that the app was built or started. Preview/help return `0` without installing.

## Rerun, management and recovery

Rerun the same installer with the same `--dir` to resume its pinned revision.
It refuses unrelated folders and tracked changes rather than resetting them.
Completed steps are rechecked. A running managed service is left unchanged;
stop it before changing ports or reinstalling dependencies.

Installer-owned files live in `<application>/.swarmcrews-install/`:

- `state.json`: revision and non-secret setup choices;
- `install.log`: dependency/build diagnostics (not provider login output);
- `manage.mjs`: start/stop/status/restart wrapper using the chosen Node and ports;
- `tools/`: the private pnpm installation.

Setup prints the correctly quoted management command for your OS. Replace its
last argument, `status`, with `start`, `stop`, or `restart`. No shell profile or
user PATH is changed. Keep the application directory and its managed runtime in
place; this initial source installer does not relocate them automatically.

Application service logs remain in `.run/swarmcrews.log`. Project state remains
in Swarmcrews' normal state home, separately from the installation directory.
Review logs before sharing them; automatic redaction is not a guarantee that all
third-party diagnostics are free of sensitive data.

A sibling `<application>.swarmcrews-install.lock` prevents concurrent setup for
the same path. A hard kill or power loss can leave it behind: confirm no installer
is running before removing that lock. A partial clone without installer state is
not automatically deleted or adopted; inspect it and choose another empty folder.

Setup does not configure Tailscale, autostart at login, OS services, automatic
updates or uninstall. Use the [manual update instructions](../README.md#quick-start)
for a normal developer checkout; for managed installs, install a newer source
revision into a new folder, stop the old service, and start the new one against
your existing state home. Back up state before upgrades; database changes can
make downgrades unsafe.
