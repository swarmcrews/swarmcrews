#!/usr/bin/env bash
# Standalone Linux entrypoint. No installer package dependencies.
# Downloads source (main by default), not a prebuilt release. Review before running.
set -euo pipefail
PLATFORM='linux'
NODE_VERSION='22.22.0'
REPO='https://github.com/swarmcrews/swarmcrews.git'
REF="${SWARMCREWS_REF:-main}"
color='' reset=''
if [[ -t 1 && "${TERM:-dumb}" != dumb && -z "${NO_COLOR+x}" ]]; then
  color=$'\033[1;33m'; reset=$'\033[0m'
fi
printf '\n%s  \\  ^  /\n   \\___/   SWARMCREWS%s\n\n  Linux / bootstrap\n  Your workspace. Your agents.\n\n' "$color" "$reset"
fail() { printf '\n  [FIX] %s\n' "$*" >&2; exit 1; }
confirm() {
  [[ -t 0 && -t 1 ]] || fail 'A prerequisite is missing. Run in an interactive terminal; unattended setup never installs system tools.'
  printf '  %s [y/N] ' "$1"
  local answer
  read -r answer || exit 130
  [[ "$answer" == y || "$answer" == Y || "$answer" == yes ]]
}
case "$PLATFORM:$(uname -s)" in linux:Linux|darwin:Darwin) ;; *) fail 'Wrong OS entrypoint. Choose linux.sh, macos.sh or windows.ps1.' ;; esac
if [[ "${1:-}" == --help ]]; then
  printf '  Usage: bash install/linux.sh [--dir PATH] [--agent NAME] [--yes]\n  Other options: --check, --preview, --skip-start, --port N, --backend-port N\n  Bootstrap requires curl, tar and Git; missing Git can be installed with consent.\n  SWARMCREWS_REF selects source; SWARMCREWS_MANAGED_NODE=1 selects private Node.\n'; exit 0
fi
# Read-only modes never download, provision tools or create temporary directories.
for arg in "$@"; do
  if [[ "$arg" == --check || "$arg" == --preview ]]; then
    local_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
    command -v node >/dev/null || fail 'Read-only mode needs an existing Node runtime; no tools were installed.'
    [[ -f "$local_root/scripts/install/wizard.mjs" ]] || fail 'Read-only mode needs a local checkout; no source was downloaded.'
    exec node "$local_root/scripts/install/wizard.mjs" "$@"
  fi
done
[[ "$(id -u)" != 0 ]] || fail 'Run as your normal user, not root. Only approved package-manager commands may use sudo.'
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) fail 'Supported bootstrap architectures: x64 and arm64.' ;; esac
if [[ "$PLATFORM" == linux ]] && ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
  fail 'This bootstrap supports glibc Linux. On musl/Alpine, install a compatible Node and use the manual source workflow.'
fi
command -v curl >/dev/null || fail 'Install curl with your OS package manager and rerun setup.'
command -v tar >/dev/null || fail 'Install tar with your OS package manager and rerun setup.'
TEMP=$(mktemp -d "${TMPDIR:-/tmp}/swarmcrews-setup.XXXXXXXX")
trap 'rm -rf -- "$TEMP"' EXIT
trap 'exit 130' INT TERM
node_bin=$(command -v node || true)
if [[ "${SWARMCREWS_MANAGED_NODE:-0}" == 1 ]] || [[ -z "$node_bin" ]] || ! "$node_bin" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' 2>/dev/null; then
  runtime="${XDG_DATA_HOME:-$HOME/.local/share}/swarmcrews/runtime/node-v${NODE_VERSION}-${PLATFORM}-${arch}"
  node_bin="$runtime/bin/node"
  if [[ ! -x "$node_bin" ]]; then
    printf '  [WAIT] Node >=22.12.0 is required.\n  Managed runtime: %s\n  Download: https://nodejs.org/dist/v%s/\n  Your global Node and shell profile will not change.\n' "$runtime" "$NODE_VERSION"
    confirm 'Download and install this private Node runtime?' || exit 130
    archive="node-v${NODE_VERSION}-${PLATFORM}-${arch}.tar.gz"
    base="https://nodejs.org/dist/v${NODE_VERSION}"
    curl --fail --location --proto '=https' --tlsv1.2 --retry 2 "$base/$archive" -o "$TEMP/$archive"
    curl --fail --location --proto '=https' --tlsv1.2 --retry 2 "$base/SHASUMS256.txt" -o "$TEMP/SHASUMS256.txt"
    expected=$(awk -v f="$archive" '$2 == f {print $1}' "$TEMP/SHASUMS256.txt")
    [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail 'Official Node checksum was not found.'
    if command -v sha256sum >/dev/null; then actual=$(sha256sum "$TEMP/$archive" | awk '{print $1}')
    elif command -v shasum >/dev/null; then actual=$(shasum -a 256 "$TEMP/$archive" | awk '{print $1}')
    else fail 'A SHA-256 tool (sha256sum or shasum) is required.'; fi
    [[ "$actual" == "$expected" ]] || fail 'Node checksum mismatch. Nothing was installed.'
    tar -xzf "$TEMP/$archive" -C "$TEMP"
    mkdir -p "$(dirname "$runtime")"
    [[ ! -e "$runtime" ]] || fail 'Runtime destination already exists but is incomplete. Inspect it before retrying.'
    mv "$TEMP/node-v${NODE_VERSION}-${PLATFORM}-${arch}" "$runtime"
  fi
fi
"$node_bin" --version || fail 'Managed Node cannot run on this host; check OS compatibility.'
export PATH="$(dirname "$node_bin"):$PATH"
if ! git --version >/dev/null 2>&1; then
  printf '  [WAIT] Git is required for application source and agent workspaces.\n'
  if [[ "$PLATFORM" == darwin ]]; then
    if command -v brew >/dev/null; then
      confirm 'Run brew install git?' || exit 130
      brew install git
    else
      fail 'Run xcode-select --install, complete Apple Command Line Tools setup, then rerun. Homebrew is not required.'
    fi
  elif command -v apt-get >/dev/null; then
    confirm 'Run sudo apt-get install git?' || exit 130; sudo apt-get install git
  elif command -v dnf >/dev/null; then
    confirm 'Run sudo dnf install git?' || exit 130; sudo dnf install git
  elif command -v pacman >/dev/null; then
    confirm 'Run sudo pacman -S git?' || exit 130; sudo pacman -S git
  elif command -v zypper >/dev/null; then
    confirm 'Run sudo zypper install git?' || exit 130; sudo zypper install git
  else fail 'Install Git using https://git-scm.com/downloads and rerun.'; fi
fi
git --version >/dev/null || fail 'Git is still unavailable. Reopen your terminal and rerun.'
local_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ -f "$local_root/scripts/install/wizard.mjs" && -f "$local_root/package.json" ]]; then
  source_root="$local_root"
else
  [[ "$REF" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ ]] || fail 'Invalid SWARMCREWS_REF.'
  printf '\n  Source: %s\n  Ref: %s (source install, not a signed prebuilt release)\n' "$REPO" "$REF"
  confirm 'Download this source to a temporary folder?' || exit 130
  source_root="$TEMP/source"
  git init -q "$source_root"
  git -C "$source_root" remote add origin "$REPO"
  git -C "$source_root" fetch --depth 1 origin "$REF"
  git -C "$source_root" checkout --detach FETCH_HEAD
fi
set +e
"$node_bin" "$source_root/scripts/install/wizard.mjs" "$@"
result=$?
set -e
exit "$result"
