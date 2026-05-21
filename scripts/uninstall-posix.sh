#!/usr/bin/env bash
set -euo pipefail

INSTALL_PLATFORM="posix"
PRODUCT_NAME="${AGENTX_PRODUCT_NAME:-agentX}"
BINARY_NAME="${AGENTX_BINARY:-agentx}"
LEGACY_BINARY_NAME="${AGENTX_LEGACY_BINARY:-ogb}"
PACKAGE_NAME="${AGENTX_PACKAGE:-agentx}"
LEGACY_PACKAGE_NAME="${AGENTX_LEGACY_PACKAGE:-opencode-gemini-bridge}"
STABLE_CLI_DIR_NAME="${AGENTX_STABLE_CLI_DIR:-$PACKAGE_NAME-cli}"
LEGACY_STABLE_CLI_DIR_NAME="${AGENTX_LEGACY_STABLE_CLI_DIR:-opencode-gemini-bridge-cli}"

usage() {
  cat <<'EOF'
Usage: uninstall-posix.sh [--platform darwin|linux] [--project PATH] [--prefix PATH] [--remove-project-files]

Removes the global agentX CLI installed by install-mac.sh or install-linux.sh.

By default, project files are kept. Pass --remove-project-files to remove only
agentX-managed project plugins/generated dashboard files; user Gemini extensions
and OpenCode config are not deleted.
EOF
}

default_prefix() {
  if [[ -n "${AGENTX_PREFIX:-}" ]]; then
    printf '%s\n' "$AGENTX_PREFIX"
    return
  fi
  if [[ -n "${OGB_PREFIX:-}" ]]; then
    printf '%s\n' "$OGB_PREFIX"
    return
  fi
  npm prefix -g 2>/dev/null || printf '%s/.local' "$HOME"
}

PROJECT_DIR="$(pwd)"
PREFIX="$(default_prefix)"
REMOVE_PROJECT_FILES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      INSTALL_PLATFORM="$2"
      shift 2
      ;;
    --project)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --prefix)
      PREFIX="$2"
      shift 2
      ;;
    --remove-project-files)
      REMOVE_PROJECT_FILES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$INSTALL_PLATFORM" in
  posix|darwin|linux)
    ;;
  *)
    echo "Unsupported POSIX platform: $INSTALL_PLATFORM" >&2
    usage >&2
    exit 2
    ;;
esac

echo "Removing $PRODUCT_NAME command shims from $PREFIX..."
rm -f "$PREFIX/bin/$BINARY_NAME" "$PREFIX/bin/$LEGACY_BINARY_NAME"
rm -rf "$HOME/.ai/opencode-pack/$STABLE_CLI_DIR_NAME" "$HOME/.ai/opencode-pack/$LEGACY_STABLE_CLI_DIR_NAME"
if command -v npm >/dev/null 2>&1; then
  npm uninstall --prefix "$PREFIX" -g "$PACKAGE_NAME" "$LEGACY_PACKAGE_NAME" >/dev/null 2>&1 || true
fi

if [[ "$REMOVE_PROJECT_FILES" -eq 1 ]]; then
  echo "Removing agentX-managed project runtime files from $PROJECT_DIR..."
  rm -f "$PROJECT_DIR/.opencode/plugins/ogb-startup-sync.js"
  rm -f "$PROJECT_DIR/.opencode/tui-plugins/ogb-sidebar.js"
  rm -f "$PROJECT_DIR/.opencode/generated/ogb-dashboard.json"
  rm -f "$PROJECT_DIR/.opencode/generated/ogb-dashboard.md"
  rm -f "$PROJECT_DIR/.opencode/generated/ogb-plugin-status.json"
  rm -f "$PROJECT_DIR/.opencode/generated/ogb-startup-sync.json"
fi

echo "Done."
