#!/bin/sh
set -eu

repo_url=https://github.com/yomon8/markport
install_dir=${HOME:?HOME is not set}/.local/bin

if [ "$(uname -s)" != Linux ]; then
  echo 'This installer supports Linux only.' >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64) arch=arm64 ;;
  *) echo "Unsupported CPU architecture: $(uname -m)" >&2; exit 1 ;;
esac

release_url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "$repo_url/releases/latest")
case "$release_url" in
  "$repo_url"/releases/tag/v[0-9]*) version=${release_url##*/} ;;
  *) echo "Could not determine the latest release: $release_url" >&2; exit 1 ;;
esac
case "$version" in
  *[!A-Za-z0-9._-]*) echo "Invalid release version: $version" >&2; exit 1 ;;
esac

asset="markport_${version}_linux_${arch}"
checksum="checksums_${version}.txt"
download_url="$repo_url/releases/download/$version"
download_dir=$(mktemp -d)
stage_dir=
cleanup() {
  rm -rf "$download_dir"
  if [ -n "$stage_dir" ]; then
    rm -rf "$stage_dir"
  fi
}
trap cleanup 0
trap 'exit 1' 1 2 3 15

cd "$download_dir"
curl -fsSL -o "$asset" "$download_url/$asset"
curl -fsSL -o "$checksum" "$download_url/$checksum"
awk -v wanted="$asset" '$2 == wanted { print }' "$checksum" > selected-checksum.txt
if [ "$(wc -l < selected-checksum.txt)" -ne 1 ]; then
  echo "Expected one checksum for $asset." >&2
  exit 1
fi
sha256sum --check selected-checksum.txt

mkdir -p "$install_dir"
stage_dir=$(mktemp -d "$install_dir/.markport-install.XXXXXX")
install -m 755 "$asset" "$stage_dir/markport"
if [ "$("$stage_dir/markport" --version)" != "$version" ]; then
  echo "Downloaded binary does not report $version." >&2
  exit 1
fi
mv -fT "$stage_dir/markport" "$install_dir/markport"
echo "Installed markport $version to $install_dir/markport"
