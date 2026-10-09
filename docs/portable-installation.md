# Portable Swarmcrews

Portable release archives contain the compiled application, its runtime libraries,
and a pinned Node runtime. They do **not** contain provider SDKs or harness CLIs.
No application build, Node installation, or package-manager install is needed to
run the archive. Git is still required for repository operations.

Use only assets from [Swarmcrews releases](https://github.com/swarmcrews/swarmcrews/releases).
An alpha is a prerelease, not the GitHub `latest` release. Select the exact version
and the archive matching your OS and CPU. Only targets tested by the release
workflow are published. Linux builds target glibc systems, not Alpine/musl.
The initial native test matrix is Ubuntu 22.04 x64, macOS 15 Intel/Apple Silicon,
and Windows Server 2022 x64. Linux/Windows ARM64 archives are not provided.

## Download-only installers

For **v0.1.0-alpha.2**, download and inspect the installer at that exact tag before
running it. These installers verify the archive's SHA-256, reject unsafe archive
paths, and require a **new** destination. They never fall back to building source,
install a harness, launch the app, or change your PATH. An unavailable release or
failed download stops installation; there is no fallback to `main` or `latest`.

Linux/macOS (curl, tar, and a SHA-256 utility required):

```sh
curl --fail --location https://raw.githubusercontent.com/swarmcrews/swarmcrews/v0.1.0-alpha.2/install/portable.sh -o swarmcrews-portable.sh
# Inspect swarmcrews-portable.sh, then:
sh swarmcrews-portable.sh "$HOME/.local/opt/swarmcrews-0.1.0-alpha.2"
```

Windows PowerShell:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/swarmcrews/swarmcrews/v0.1.0-alpha.2/install/portable.ps1 -OutFile swarmcrews-portable.ps1
# Inspect swarmcrews-portable.ps1, then:
.\\swarmcrews-portable.ps1 -Destination "$env:LOCALAPPDATA\\Swarmcrews\\0.1.0-alpha.2"
```

Run without root/Administrator privileges. These are unsigned portable packages,
not signed MSI/DMG installers. Follow your organization's downloaded-script and
application trust policy; the installers do not bypass it. For source builds,
see [guided installation](./installing.md).

## Verify, extract, launch

Download the archive and its `.sha256` file from the **same release**. Check the
SHA-256 before extraction (`sha256sum -c FILE.sha256` on Linux,
`shasum -a 256 -c FILE.sha256` on macOS, or compare `Get-FileHash FILE -Algorithm SHA256`
with the checksum on Windows). Checksums detect corrupted or mismatched downloads;
GitHub build attestations provide the additional build-provenance check:

```sh
gh attestation verify FILE --repo swarmcrews/swarmcrews --signer-workflow swarmcrews/swarmcrews/.github/workflows/release.yml
```

Extract into a new directory. Do not overwrite a running installation.
Run `./swarmcrews` on Linux/macOS or `swarmcrews.cmd` on Windows.
The app runs in the **foreground** at `http://localhost:6173`. Press Ctrl-C to stop.
`--version` prints the installed version. The Settings restart action restarts the
compiled backend; it never rebuilds or installs dependencies.

`PORT` changes the single UI/API/WebSocket port. `HOST` defaults to `127.0.0.1`.
Only trusted loopback/tailnet browser hosts are supported; do not expose the app
on the public internet. Source installations still use separate frontend and
backend ports and their existing `pnpm start`/`stop` workflow.

State stays under `SWARMCREWS_HOME` (normally `~/.swarmcrews`, with the existing
legacy-home selection rules). It is never stored in the archive. Back up this
state before upgrading an alpha. Stop the old process, extract the new version
elsewhere, and start its launcher. Keep the old archive and backup for recovery;
there is no automatic updater or automatic database downgrade.

## Install harnesses separately

Swarmcrews opens with **zero harnesses installed**. Install and authenticate only
the providers you want, using their official instructions. Provider licenses,
accounts, and authentication remain separate from Swarmcrews. Nothing here is
installed automatically, and Swarmcrews does not collect provider credentials.

Claude, Codex, and Copilot adapters also need separately installed SDKs. With a
separately installed Node/npm toolchain, create dedicated installation prefixes
outside your project checkout and outside the portable app:

```sh
npm install --prefix "$HOME/swarmcrews-harnesses/claude" @anthropic-ai/claude-agent-sdk@0.3.280
npm install --prefix "$HOME/swarmcrews-harnesses/codex" @openai/codex-sdk@0.156.1
npm install --prefix "$HOME/swarmcrews-harnesses/copilot" @github/copilot-sdk@1.0.13

export CLAUDE_SDK_ROOT="$HOME/swarmcrews-harnesses/claude"
export CODEX_SDK_ROOT="$HOME/swarmcrews-harnesses/codex"
export COPILOT_SDK_ROOT="$HOME/swarmcrews-harnesses/copilot"
```

Run only the commands for your chosen providers. SDKs may download their own
provider runtime dependencies under their own terms. These installations are not
part of the Swarmcrews archive. Set the environment variables in the terminal
where you launch Swarmcrews. On PowerShell, use `$env:CLAUDE_SDK_ROOT = 'C:\absolute\prefix'`
(and the corresponding variables for the other SDKs). The prefix must contain
`node_modules`; it is **not** a path to the SDK entry file. Explicit bad paths fail
rather than silently selecting another SDK from a project.

| Harness | Runtime selection and setup |
|---|---|
| [Claude Code](https://code.claude.com/docs/en/setup) | `CLAUDE_CODE_PATH`, an installed `claude` on PATH, or the separately installed Agent SDK's native runtime. Authenticate with Claude. |
| [Codex](https://github.com/openai/codex) | `CODEX_PATH`, PATH, or the separately installed Codex SDK's runtime. Authenticate with `codex login`. |
| [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started) | Install Copilot CLI separately, sign in, and put it on PATH or set `COPILOT_CLI_PATH`. |
| [OpenCode](https://opencode.ai/docs/) | Install and configure OpenCode; PATH or `OPENCODE_PATH`. No SDK installation is needed. |
| [Pi](https://github.com/earendil-works/pi) | Install and configure Pi; PATH or `PI_PATH`. No SDK installation is needed. |

All executable overrides are absolute paths. Refresh harness readiness after
installation or authentication. Missing dependencies remain visible with setup
hints; no harness becomes ready until authentication and model discovery succeed.
Requested sandbox settings are not proof of enforcement: inspect the effective
policy, including any axes reported as unmanaged.
