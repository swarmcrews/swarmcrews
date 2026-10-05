#!/bin/sh
# Download-only installer: no source checkout, build, package manager or harness setup.
set -eu
version=0.1.0-alpha.1
if [ "${1:-}" = "--help" ]; then
  printf '%s\n' "Usage: sh portable.sh [new-install-directory]" "Downloads Swarmcrews $version; does not install harnesses or start the app."
  exit 0
fi
[ "$#" -le 1 ] || { echo "Expected at most one destination directory" >&2; exit 1; }
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) target=linux-x64
    if ldd --version 2>&1 | grep -qi musl; then echo "Linux musl is not supported by this release" >&2; exit 1; fi ;;
  Darwin:x86_64) target=darwin-x64 ;;
  Darwin:arm64) target=darwin-arm64 ;;
  *) echo "Unsupported OS/architecture; use the source installation guide" >&2; exit 1 ;;
esac
base="swarmcrews-$version-$target"
archive="$base.tar.gz"
destination=${1:-"$HOME/.local/opt/swarmcrews-$version"}
case "$destination" in /*) ;; *) destination="$PWD/$destination" ;; esac
[ ! -e "$destination" ] && [ ! -L "$destination" ] || { echo "Destination already exists; nothing was changed" >&2; exit 1; }
url="https://github.com/swarmcrews/swarmcrews/releases/download/v$version"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 300 "$url/$archive" -o "$stage/$archive"
curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 60 "$url/$archive.sha256" -o "$stage/checksum"
expected=$(cat "$stage/checksum")
if command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum "$stage/$archive" | cut -d ' ' -f 1)
else
  digest=$(shasum -a 256 "$stage/$archive" | cut -d ' ' -f 1)
fi
[ "$expected" = "$digest  $archive" ] || { echo "Archive checksum mismatch; refusing installation" >&2; exit 1; }
# Release archives contain regular files/directories only, under one root.
tar -tzf "$stage/$archive" > "$stage/entries"
awk -v prefix="$base" 'BEGIN { bad=0 } { n=split($0,p,"/"); if (p[1]!=prefix || $0 ~ /\\/) bad=1; for(i=1;i<=n;i++) if(p[i]=="..") bad=1 } END { exit bad }' "$stage/entries" || { echo "Unsafe archive paths" >&2; exit 1; }
tar -tvzf "$stage/$archive" > "$stage/types"
if grep -v '^[d-]' "$stage/types" >/dev/null; then echo "Archive contains links or special files" >&2; exit 1; fi
tar -xzf "$stage/$archive" -C "$stage"
[ -f "$stage/$base/swarmcrews" ] && [ -x "$stage/$base/runtime/node" ] || { echo "Incomplete archive" >&2; exit 1; }
mkdir -p "$(dirname "$destination")"
# mkdir claims a NEW destination atomically; never merge into another install.
mkdir "$destination"
cp -R "$stage/$base/." "$destination/"
printf 'Installed Swarmcrews to %s\nLaunch: %s/swarmcrews\nHarnesses are separate installs; see INSTALL.md.\n' "$destination" "$destination"
