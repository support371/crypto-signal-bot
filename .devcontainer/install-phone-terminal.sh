#!/usr/bin/env bash
set -euo pipefail

VERSION="1.7.7"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ASSET="ttyd.x86_64" ;;
  aarch64|arm64) ASSET="ttyd.aarch64" ;;
  *)
    echo "Unsupported architecture for the pinned ttyd release: $ARCH" >&2
    exit 1
    ;;
esac

BASE_URL="https://github.com/tsl0922/ttyd/releases/download/${VERSION}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
curl --fail --location --silent --show-error "${BASE_URL}/${ASSET}" --output "${TMP_DIR}/${ASSET}"
curl --fail --location --silent --show-error "${BASE_URL}/SHA256SUMS" --output "${TMP_DIR}/SHA256SUMS"

(
  cd "$TMP_DIR"
  grep -E "[[:space:]]${ASSET}$" SHA256SUMS > SHA256SUMS.selected
  test -s SHA256SUMS.selected
  sha256sum --check SHA256SUMS.selected
)

chmod 0755 "${TMP_DIR}/${ASSET}"
sudo install -m 0755 "${TMP_DIR}/${ASSET}" /usr/local/bin/ttyd
/usr/local/bin/ttyd --version
