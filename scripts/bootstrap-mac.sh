#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: bootstrap-mac.sh [--repo OWNER/REPO] [--version vX.Y.Z|latest] [installer args...]

Downloads the $PRODUCT_NAME release pack from GitHub and runs the
bundled macOS installer.

Examples:
  curl -fsSL https://raw.githubusercontent.com/$DEFAULT_REPO/main/scripts/bootstrap-mac.sh | bash -s -- --project "\$PWD"
  AGENTX_GITHUB_REPO=$DEFAULT_REPO bash bootstrap-mac.sh --project "\$PWD" --force
EOF
}

PRODUCT_NAME="${AGENTX_PRODUCT_NAME:-agentX}"
DEFAULT_REPO="${AGENTX_GITHUB_REPO:-augustocaruso/agentx}"
RELEASE_ASSET="${AGENTX_RELEASE_ASSET:-agentx-pack.zip}"
TEMP_PREFIX="${AGENTX_TEMP_PREFIX:-agentx-bootstrap}"
ZIP_NAME="${AGENTX_RELEASE_ZIP_NAME:-agentx.zip}"
REPO="${OGB_GITHUB_REPO:-$DEFAULT_REPO}"
VERSION="${OGB_RELEASE_VERSION:-latest}"
INSTALLER_ARGS=()

run_installer() {
  if [[ "${#INSTALLER_ARGS[@]}" -gt 0 ]]; then
    exec bash "$INSTALLER" "${INSTALLER_ARGS[@]}"
  fi
  exec bash "$INSTALLER"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="$2"
      shift 2
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      INSTALLER_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download the $PRODUCT_NAME release pack." >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip is required to unpack the $PRODUCT_NAME release pack." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/$TEMP_PREFIX.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ "$VERSION" == "latest" ]]; then
  RELEASE_URL="https://github.com/$REPO/releases/latest/download/$RELEASE_ASSET"
else
  RELEASE_URL="https://github.com/$REPO/releases/download/$VERSION/$RELEASE_ASSET"
fi

echo "Downloading $PRODUCT_NAME from $RELEASE_URL..."
curl -fL "$RELEASE_URL" -o "$TMP_DIR/$ZIP_NAME"

unzip -q "$TMP_DIR/$ZIP_NAME" -d "$TMP_DIR/unpacked"
INSTALLER="$(find "$TMP_DIR/unpacked" -path '*/scripts/install-mac.sh' -type f | head -n 1)"

if [[ -z "$INSTALLER" ]]; then
  echo "Release pack did not contain scripts/install-mac.sh." >&2
  exit 1
fi

chmod +x "$INSTALLER"
run_installer
