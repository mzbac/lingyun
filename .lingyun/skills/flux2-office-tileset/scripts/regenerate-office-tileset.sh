#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  regenerate-office-tileset.sh [--force] [--repo /path/to/repo]

Options:
  --force          Regenerate all raw FLUX images (sets OFFICE_TILESET_FORCE=1)
  --repo <path>    Repo root path (defaults to git root of current directory)
EOF
}

FORCE_DEFAULT=0
REPO_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE_DEFAULT=1
      shift
      ;;
    --repo)
      REPO_ROOT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$REPO_ROOT" ]]; then
  if REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    :
  else
    echo "Error: not in a git repo; pass --repo /path/to/repo" >&2
    exit 1
  fi
fi

if [[ ! -f "$REPO_ROOT/packages/vscode-extension/package.json" ]]; then
  echo "Error: repo root does not look like lingyun.public: $REPO_ROOT" >&2
  exit 1
fi

cd "$REPO_ROOT"

export OFFICE_TILESET_FORCE="${OFFICE_TILESET_FORCE:-$FORCE_DEFAULT}"
export FLUX2_MODEL="${FLUX2_MODEL:-mzbac/FLUX.2-klein-9B-q8}"

# Ensure the skill's Node dependencies are installed (pngjs).
if ! (cd "$SKILL_ROOT" && node -e "require('pngjs')" >/dev/null 2>&1); then
  echo "[office-tileset] installing node deps (pngjs) in: $SKILL_ROOT"
  (cd "$SKILL_ROOT" && npm install --no-fund --no-audit)
fi

if [[ -z "${OFFICE_TILESET_STYLE_PALETTE_IMAGE:-}" ]]; then
  STYLE_CANDIDATE="$REPO_ROOT/temp/Gemini_Generated_Image_vowkpuvowkpuvowk.png"
  if [[ -f "$STYLE_CANDIDATE" ]]; then
    export OFFICE_TILESET_STYLE_PALETTE_IMAGE="$STYLE_CANDIDATE"
  fi
fi

if [[ -n "${FLUX2_CLI:-}" ]]; then
  :
elif command -v flux2-cli >/dev/null 2>&1; then
  export FLUX2_CLI="flux2-cli"
else
  export FLUX2_CLI="$(bash "$SCRIPT_DIR/download-flux2-cli.sh")"
fi

node "$SCRIPT_DIR/generate-office-tileset.js" --repo "$REPO_ROOT"
pnpm --filter lingyun office:build

echo "[office-tileset] tileset: $REPO_ROOT/packages/vscode-extension/office-webview/public/assets/office-tileset.png"
echo "[office-tileset] preview: $REPO_ROOT/temp/office-tileset/preview/office-tileset@8x.png"
