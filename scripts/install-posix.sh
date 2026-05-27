#!/usr/bin/env bash
set -euo pipefail

INSTALL_PLATFORM="darwin"
PRODUCT_NAME="${AGENTX_PRODUCT_NAME:-agentX}"
BINARY_NAME="${AGENTX_BINARY:-agentx}"
LEGACY_BINARY_NAME="${AGENTX_LEGACY_BINARY:-ogb}"
PACKAGE_NAME="${AGENTX_PACKAGE:-agentx}"
LEGACY_PACKAGE_NAME="${AGENTX_LEGACY_PACKAGE:-opencode-gemini-bridge}"
STABLE_CLI_DIR_NAME="${AGENTX_STABLE_CLI_DIR:-$PACKAGE_NAME-cli}"
LEGACY_STABLE_CLI_DIR_NAME="${AGENTX_LEGACY_STABLE_CLI_DIR:-opencode-gemini-bridge-cli}"
STATE_DIR_NAME="${AGENTX_STATE_DIR:-agentx}"
SOURCE_PACKAGE_DIR="${AGENTX_SOURCE_PACKAGE_DIR:-agentx}"
WRITE_LEGACY_ALIAS="${AGENTX_WRITE_LEGACY_ALIAS:-0}"

usage() {
  cat <<EOF
Usage: install-posix.sh [--platform darwin|linux] [--project PATH] [--prefix PATH] [--no-setup] [--no-ux] [--no-opencode] [--force] [--keep-legacy] [--rulesync MODE] [--skip-install-check]

Installs the $PRODUCT_NAME CLI, then runs the managed setup through:
$BINARY_NAME install

Defaults:
  --project  current working directory
  --prefix   \$AGENTX_PREFIX, else \$OGB_PREFIX, else a writable command prefix
             already on PATH, else \$HOME/.local

Examples:
  scripts/install-mac.sh --project "\$PWD"
  scripts/install-linux.sh --project "\$PWD"
  scripts/install-linux.sh --project ~/Code/my-project --prefix ~/.local
EOF
}

path_contains() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
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

  local npm_prefix
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  if [[ -n "$npm_prefix" && -d "$npm_prefix" && -w "$npm_prefix" && -d "$npm_prefix/bin" ]] && path_contains "$npm_prefix/bin"; then
    printf '%s\n' "$npm_prefix"
    return
  fi

  printf '%s\n' "$HOME/.local"
}

bash_quote() {
  printf '%q' "$1"
}

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

require_node_22() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js >=22 is required before installing $PRODUCT_NAME." >&2
    exit 1
  fi

  local node_version
  local node_major
  node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  node_major="${node_version%%.*}"
  if [[ ! "$node_major" =~ ^[0-9]+$ || "$node_major" -lt 22 ]]; then
    echo "Node.js >=22 is required before installing $PRODUCT_NAME. Found Node.js ${node_version:-unknown} at $(command -v node)." >&2
    exit 1
  fi
}

repair_directory_blocker() {
  local dir="$1"
  local operation="$2"
  if [[ ! -e "$dir" || -d "$dir" ]]; then
    return
  fi

  local stamp
  local backup_root
  local relative
  local backup_path
  local home_prefix
  stamp="$(date -u +"%Y-%m-%dT%H-%M-%SZ")-$$"
  backup_root="$HOME/.config/$STATE_DIR_NAME/backups/$operation/$stamp/home"
  relative="$dir"
  home_prefix="$HOME/"
  case "$relative" in
    "$home_prefix"*) relative="${relative#"$home_prefix"}" ;;
  esac
  backup_path="$backup_root/$relative"
  mkdir -p "$(dirname "$backup_path")"
  mv "$dir" "$backup_path"
  mkdir -p "$dir"
  echo "Repaired file blocking OpenCode config directory: $dir (backup: $backup_path)"
}

emit_unique_targets() {
  local seen=$'\n'
  local target
  for target in "$@"; do
    if [[ -z "$target" ]]; then
      continue
    fi
    if [[ "$seen" == *$'\n'"$target"$'\n'* ]]; then
      continue
    fi
    printf '%s\n' "$target"
    seen+="$target"$'\n'
  done
}

linux_profile_targets() {
  local shell_name="${SHELL##*/}"
  case "$shell_name" in
    bash)
      emit_unique_targets "$HOME/.profile" "$HOME/.bashrc"
      ;;
    zsh)
      emit_unique_targets "$HOME/.profile" "$HOME/.zshrc"
      ;;
    fish)
      emit_unique_targets "$HOME/.profile" "$HOME/.config/fish/config.fish"
      ;;
    *)
      emit_unique_targets "$HOME/.profile"
      ;;
  esac
}

is_fish_config_target() {
  [[ "$1" == "$HOME/.config/fish/config.fish" ]]
}

path_profile_targets() {
  if [[ "$INSTALL_PLATFORM" == "linux" ]]; then
    linux_profile_targets
  else
    emit_unique_targets "$HOME/.zshrc"
  fi
}

exa_profile_targets() {
  if [[ "$INSTALL_PLATFORM" == "linux" ]]; then
    linux_profile_targets
  else
    emit_unique_targets "$HOME/.config/zsh/.zshrc"
  fi
}

ensure_path_on_profiles() {
  local path_line="export PATH=\"$PREFIX/bin:\$PATH\""
  local fish_path_block
  local target

  fish_path_block="$(cat <<EOF
if not contains "$PREFIX/bin" \$PATH
    set -gx PATH "$PREFIX/bin" \$PATH
end
EOF
)"

  if [[ ":$PATH:" == *":$PREFIX/bin:"* ]]; then
    return
  fi

  while IFS= read -r target; do
    mkdir -p "$(dirname "$target")"
    if [[ -f "$target" ]] && grep -Fq "$PREFIX/bin" "$target"; then
      echo "Note: $PREFIX/bin is already mentioned in $target, but not active in this shell."
    elif is_fish_config_target "$target"; then
      printf '\n# Added by %s installer\n%s\n' "$PRODUCT_NAME" "$fish_path_block" >> "$target"
      echo "Added $PREFIX/bin to $target."
    else
      printf '\n# Added by %s installer\n%s\n' "$PRODUCT_NAME" "$path_line" >> "$target"
      echo "Added $PREFIX/bin to $target."
    fi
  done < <(path_profile_targets)

  export PATH="$PREFIX/bin:$PATH"
}

ensure_opencode_exa_env() {
  local exa_line="export OPENCODE_ENABLE_EXA=1"
  local fish_exa_line="set -gx OPENCODE_ENABLE_EXA 1"
  local exa_pattern='^[[:space:]]*(export[[:space:]]+)?OPENCODE_ENABLE_EXA=1([[:space:]]*(#.*)?)?$'
  local fish_exa_pattern='^[[:space:]]*set[[:space:]]+-(gx|xg)[[:space:]]+OPENCODE_ENABLE_EXA[[:space:]]+1([[:space:]]*(#.*)?)?$'
  local line
  local pattern
  local target

  while IFS= read -r target; do
    if is_fish_config_target "$target"; then
      line="$fish_exa_line"
      pattern="$fish_exa_pattern"
    else
      line="$exa_line"
      pattern="$exa_pattern"
    fi

    mkdir -p "$(dirname "$target")"
    if [[ -f "$target" ]] && grep -Eq "$pattern" "$target"; then
      echo "OpenCode Exa websearch env already configured in $target."
    else
      printf '\n# Enable OpenCode native websearch backed by Exa.\n%s\n' "$line" >> "$target"
      echo "Added OPENCODE_ENABLE_EXA=1 to $target."
    fi
  done < <(exa_profile_targets)

  export OPENCODE_ENABLE_EXA=1
}

enable_installer_tui() {
  if [[ -t 1 && -z "${AGENTX_RITUAL_UI:-}" && -z "${OGB_RITUAL_UI:-}" ]]; then
    export AGENTX_RITUAL_UI=ink
  fi
}

write_primary_binary() {
  local shim_path="$1"
  local cli_target="$2"

  {
    printf '#!/usr/bin/env bash\n'
    printf 'exec node %s "$@"\n' "$(bash_quote "$cli_target")"
  } > "$shim_path"
  chmod +x "$shim_path"
}

repair_broken_command_shim() {
  local shim_path="$1"
  if [[ ! -f "$shim_path" ]]; then
    return
  fi

  local content
  content="$(cat "$shim_path" 2>/dev/null || true)"
  if [[ "$content" == *"$LEGACY_STABLE_CLI_DIR_NAME"* || "$content" == *".ai/opencode-pack"* || "$content" =~ added[[:space:]][0-9]+[[:space:]]packages ]]; then
    rm -f "$shim_path"
    echo "Removed old $PRODUCT_NAME command shim: $shim_path"
  fi
}

copy_stable_cli_payload() {
  local source_dir="$1"
  local target_dir="$2"
  local previous_dir="${3:-}"
  local cli_target

  mkdir -p "$target_dir"
  cp "$source_dir/package.json" "$target_dir/package.json"
  cp "$source_dir/package-lock.json" "$target_dir/package-lock.json"
  if [[ -f "$source_dir/LICENSE" ]]; then
    cp "$source_dir/LICENSE" "$target_dir/LICENSE"
  fi
  local telemetry_defaults
  for telemetry_defaults in telemetry.defaults.json telemetry.defaults.example.json; do
    if [[ -f "$source_dir/$telemetry_defaults" ]]; then
      cp "$source_dir/$telemetry_defaults" "$target_dir/$telemetry_defaults"
    fi
  done
  if [[ -d "$source_dir/telemetry-email-worker" ]]; then
    cp -R "$source_dir/telemetry-email-worker" "$target_dir/telemetry-email-worker"
  fi
  if [[ -d "$source_dir/scripts" ]]; then
    cp -R "$source_dir/scripts" "$target_dir/scripts"
  fi
  if [[ -d "$source_dir/runtime-plugins" ]]; then
    cp -R "$source_dir/runtime-plugins" "$target_dir/runtime-plugins"
  fi
  cp -R "$source_dir/dist" "$target_dir/dist"
  if [[ -n "$previous_dir" && -d "$previous_dir/node_modules" ]]; then
    echo "Reusing cached $PRODUCT_NAME dependencies from the previous install..."
    if ! cp -R "$previous_dir/node_modules" "$target_dir/node_modules" 2>/dev/null; then
      rm -rf "$target_dir/node_modules"
      echo "Cached dependencies could not be reused; installing fresh dependencies."
    fi
  fi

  npm --prefix "$target_dir" install --omit=dev --no-audit --no-fund --prefer-offline
  cli_target="$target_dir/dist/cli.js"
  if [[ ! -f "$cli_target" ]]; then
    echo "Expected built CLI at $cli_target, but it was not found." >&2
    return 1
  fi
  chmod +x "$cli_target" 2>/dev/null || true
}

ensure_cli_dist() {
  local cli_dir="$1"
  local cli_target="$cli_dir/dist/cli.js"

  if [[ -f "$cli_target" ]]; then
    echo "Using prebuilt $PRODUCT_NAME CLI from release pack."
    chmod +x "$cli_target" 2>/dev/null || true
    return
  fi

  echo "Prebuilt $PRODUCT_NAME CLI not found; building locally..."
  npm --prefix "$cli_dir" install
  npm --prefix "$cli_dir" run build
}

install_stable_cli() {
  local source_dir="$1"
  local install_dir="$2"
  local parent_dir
  local base_name
  local lock_dir
  local staging_dir
  local backup_dir
  local waited=0
  local status=0

  parent_dir="$(dirname "$install_dir")"
  base_name="$(basename "$install_dir")"
  mkdir -p "$parent_dir"
  lock_dir="$parent_dir/.$base_name.install.lock"

  until mkdir "$lock_dir" 2>/dev/null; do
    if [[ "$waited" -ge 120 ]]; then
      echo "Timed out waiting for another $PRODUCT_NAME install to finish: $lock_dir" >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done

  staging_dir="$(mktemp -d "$parent_dir/.$base_name.install.XXXXXX")"
  backup_dir="$parent_dir/.$base_name.previous.$$"

  if ! copy_stable_cli_payload "$source_dir" "$staging_dir" "$install_dir"; then
    status=$?
  elif [[ -e "$install_dir" || -L "$install_dir" ]] && ! mv "$install_dir" "$backup_dir"; then
    status=$?
  elif ! mv "$staging_dir" "$install_dir"; then
    status=$?
    if [[ -e "$backup_dir" || -L "$backup_dir" ]]; then
      mv "$backup_dir" "$install_dir" 2>/dev/null || true
    fi
  else
    rm -rf "$backup_dir"
  fi

  rm -rf "$staging_dir"
  rmdir "$lock_dir" 2>/dev/null || rm -rf "$lock_dir"
  return "$status"
}

write_legacy_binary_alias() {
  if [[ "$LEGACY_BINARY_NAME" == "$BINARY_NAME" ]]; then
    return
  fi

  if ! is_truthy "$WRITE_LEGACY_ALIAS"; then
    rm -f "$LEGACY_BIN"
    return
  fi

  {
    printf '#!/usr/bin/env bash\n'
    printf 'exec %s "$@"\n' "$(bash_quote "$PRIMARY_BIN")"
  } > "$LEGACY_BIN"
  chmod +x "$LEGACY_BIN"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$REPO_ROOT/packages/$SOURCE_PACKAGE_DIR"
PROJECT_DIR="$(pwd)"
PREFIX=""
RUN_SETUP=1
RUN_UX=1
RUN_HOME_SYNC=0
INSTALL_OPENCODE=1
FORCE=0
RULESYNC_MODE="auto"
SKIP_INSTALL_CHECK=0

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
    --no-setup)
      RUN_SETUP=0
      shift
      ;;
    --no-ux)
      RUN_UX=0
      shift
      ;;
    --no-opencode)
      INSTALL_OPENCODE=0
      shift
      ;;
    --rulesync)
      RULESYNC_MODE="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --keep-legacy)
      WRITE_LEGACY_ALIAS=1
      shift
      ;;
    --skip-install-check)
      SKIP_INSTALL_CHECK=1
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
  darwin|linux)
    ;;
  *)
    echo "Unsupported POSIX platform: $INSTALL_PLATFORM" >&2
    usage >&2
    exit 2
    ;;
esac

require_node_22

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required before installing $PRODUCT_NAME." >&2
  exit 1
fi

if [[ -z "$PREFIX" ]]; then
  PREFIX="$(default_prefix)"
fi

PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
if [[ "$PROJECT_DIR" == "$HOME" && "$RUN_SETUP" -eq 1 ]]; then
  echo "Home directory detected; installing global $PRODUCT_NAME/OpenCode profile and skipping project setup files."
  RUN_HOME_SYNC=1
  RUN_SETUP=0
fi

repair_directory_blocker "$HOME/.config/opencode" "posix-installer"

mkdir -p "$HOME/.config/opencode"
mkdir -p "$HOME/.agents/skills"
mkdir -p "$HOME/.ai/opencode-pack"
mkdir -p "$PREFIX/bin"

ensure_cli_dist "$CLI_DIR"

PRIMARY_BIN="$PREFIX/bin/$BINARY_NAME"
LEGACY_BIN="$PREFIX/bin/$LEGACY_BINARY_NAME"
CLI_INSTALL_DIR="$HOME/.ai/opencode-pack/$STABLE_CLI_DIR_NAME"
CLI_TARGET="$CLI_INSTALL_DIR/dist/cli.js"
echo "Installing $BINARY_NAME into a stable local folder..."
install_stable_cli "$CLI_DIR" "$CLI_INSTALL_DIR"

echo "Registering $BINARY_NAME command in $PREFIX..."
repair_broken_command_shim "$PRIMARY_BIN"
repair_broken_command_shim "$LEGACY_BIN"
rm -f "$PRIMARY_BIN"
write_primary_binary "$PRIMARY_BIN" "$CLI_TARGET"

write_legacy_binary_alias

if [[ ! -x "$PRIMARY_BIN" ]]; then
  echo "Expected $BINARY_NAME at $PRIMARY_BIN, but it was not executable." >&2
  exit 1
fi

if ! "$PRIMARY_BIN" --version >/dev/null; then
  echo "Installed $BINARY_NAME at $PRIMARY_BIN, but it did not run." >&2
  exit 1
fi

ensure_path_on_profiles
ensure_opencode_exa_env

INSTALL_ARGS=(--project "$PROJECT_DIR" install --rulesync "$RULESYNC_MODE")
INSTALL_ARGS+=(--force)
INSTALL_ARGS+=(--no-extension-update)
if [[ "$RUN_UX" -eq 0 ]]; then
  INSTALL_ARGS+=(--no-ux)
fi
if [[ "$INSTALL_OPENCODE" -eq 0 ]]; then
  INSTALL_ARGS+=(--no-install-opencode)
fi
if [[ "$FORCE" -eq 1 ]]; then
  if [[ "$RUN_HOME_SYNC" -eq 1 ]]; then
    INSTALL_ARGS+=(--reset-global)
  fi
fi
if [[ "$SKIP_INSTALL_CHECK" -eq 1 || ( "$RUN_SETUP" -eq 0 && "$RUN_HOME_SYNC" -eq 0 ) ]]; then
  INSTALL_ARGS+=(--no-check)
fi

echo "Configuring $PRODUCT_NAME for $PROJECT_DIR..."
enable_installer_tui
set +e
"$PRIMARY_BIN" "${INSTALL_ARGS[@]}"
INSTALL_STATUS=$?
set -e
if [[ "$INSTALL_STATUS" -eq 1 ]]; then
  echo "$PRODUCT_NAME install completed with notes; continuing setup."
elif [[ "$INSTALL_STATUS" -ne 0 ]]; then
  exit "$INSTALL_STATUS"
fi

echo "Done."
if command -v "$BINARY_NAME" >/dev/null 2>&1; then
  echo "$BINARY_NAME is ready for $PROJECT_DIR."
else
  echo "$BINARY_NAME command path: $PRIMARY_BIN"
fi
