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

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
URL="https://github.com/tsl0922/ttyd/releases/download/${VERSION}/${ASSET}"
curl --fail --location --silent --show-error "$URL" --output "$TMP"
chmod 0755 "$TMP"
sudo install -m 0755 "$TMP" /usr/local/bin/ttyd
/usr/local/bin/ttyd --version
