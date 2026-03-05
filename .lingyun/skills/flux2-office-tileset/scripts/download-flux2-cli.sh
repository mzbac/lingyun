#!/usr/bin/env bash
set -euo pipefail

VERSION="v0.0.1"
ASSET_ZIP="flux2-cli.macos.arm64.zip"
URL="https://github.com/mzbac/flux2.swift/releases/download/${VERSION}/${ASSET_ZIP}"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" != "Darwin" || "$ARCH" != "arm64" ]]; then
  echo "Error: flux2-cli ${VERSION} only supports macOS arm64 (Apple Silicon)." >&2
  echo "Detected: ${OS} ${ARCH}" >&2
  exit 1
fi

CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/Library/Caches}"
INSTALL_ROOT="${CACHE_ROOT}/flux2.swift/${VERSION}"
ZIP_PATH="${INSTALL_ROOT}/${ASSET_ZIP}"
BIN_PATH="${INSTALL_ROOT}/flux2-cli.macos.arm64/flux2-cli"

mkdir -p "$INSTALL_ROOT"

if [[ -x "$BIN_PATH" ]]; then
  echo "$BIN_PATH"
  exit 0
fi

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "[flux2-cli] downloading ${URL} → ${ZIP_PATH}" >&2
  curl -fL --retry 3 --retry-delay 1 -o "$ZIP_PATH" "$URL"
fi

echo "[flux2-cli] extracting ${ZIP_PATH} → ${INSTALL_ROOT}" >&2
unzip -o -q "$ZIP_PATH" -d "$INSTALL_ROOT"

if [[ ! -f "$BIN_PATH" ]]; then
  echo "Error: flux2-cli binary not found after extraction: ${BIN_PATH}" >&2
  exit 1
fi

chmod +x "$BIN_PATH"
echo "$BIN_PATH"

