#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' 0
trap 'exit 1' 1 2 3 15
mkdir -p "$test_dir/mock-bin" "$test_dir/releases" "$test_dir/home"

cat > "$test_dir/mock-bin/uname" <<'EOF'
#!/bin/sh
case "$1" in
  -s) echo Linux ;;
  -m) echo "$MOCK_ARCH" ;;
esac
EOF
cat > "$test_dir/mock-bin/curl" <<'EOF'
#!/bin/sh
set -eu
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-w) if [ "$1" = -o ]; then output=$2; fi; shift 2 ;;
    -fsSL) shift ;;
    *) url=$1; shift ;;
  esac
done
case "$url" in
  */releases/latest)
    printf 'https://github.com/yomon8/markport/releases/tag/%s' "$MOCK_VERSION"
    ;;
  */releases/download/*)
    case "${MOCK_FAIL:-}" in
      asset) case "$url" in */checksums_*) ;; *) exit 22 ;; esac ;;
      checksum) case "$url" in */checksums_*) exit 22 ;; esac ;;
    esac
    cp "$MOCK_RELEASES/${url##*/}" "$output"
    ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$test_dir/mock-bin/uname" "$test_dir/mock-bin/curl"

export HOME="$test_dir/home"
export PATH="$test_dir/mock-bin:$PATH"
export MOCK_RELEASES="$test_dir/releases"
MOCK_ARCH=x86_64
export MOCK_ARCH

make_release() {
  version=$1
  arch=${2:-amd64}
  asset="markport_${version}_linux_${arch}"
  printf '#!/bin/sh\necho %s\n' "$version" > "$MOCK_RELEASES/$asset"
  (cd "$MOCK_RELEASES" && sha256sum "$asset" > "checksums_${version}.txt")
}

assert_installed_version() {
  actual=$("$HOME/.local/bin/markport" --version)
  if [ "$actual" != "$1" ]; then
    echo "Expected installed version $1, got $actual" >&2
    exit 1
  fi
}

expect_failure() {
  if sh "$project_dir/scripts/install-linux.sh"; then
    echo 'Expected installation to fail.' >&2
    exit 1
  fi
}

make_release v1.0.0
MOCK_VERSION=v1.0.0
export MOCK_VERSION
sh "$project_dir/scripts/install-linux.sh"
assert_installed_version v1.0.0

make_release v1.1.0
MOCK_VERSION=v1.1.0
export MOCK_VERSION
sh "$project_dir/scripts/install-linux.sh"
assert_installed_version v1.1.0

printf 'corrupted\n' > "$MOCK_RELEASES/markport_v1.1.0_linux_amd64"
expect_failure
assert_installed_version v1.1.0

make_release v1.2.0
MOCK_VERSION=v1.2.0
MOCK_FAIL=asset
export MOCK_VERSION MOCK_FAIL
expect_failure
assert_installed_version v1.1.0
unset MOCK_FAIL

MOCK_FAIL=checksum
export MOCK_FAIL
expect_failure
assert_installed_version v1.1.0
unset MOCK_FAIL

MOCK_ARCH=riscv64
export MOCK_ARCH
expect_failure
assert_installed_version v1.1.0

make_release v1.3.0 arm64
MOCK_ARCH=aarch64
MOCK_VERSION=v1.3.0
export MOCK_ARCH MOCK_VERSION
sh "$project_dir/scripts/install-linux.sh"
assert_installed_version v1.3.0

echo 'Linux installer tests passed.'
