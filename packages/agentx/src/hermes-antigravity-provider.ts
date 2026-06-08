import fs from "node:fs";
import path from "node:path";
import type { BackupRecord, BackupSession } from "./backup-policy.js";

export const HERMES_ANTIGRAVITY_PROVIDER_PATCH_ID = "hermes-antigravity-provider-profile";

const ANTIGRAVITY_PROVIDER_DIR = path.join(".hermes", "plugins", "model-providers", "antigravity");
const ANTIGRAVITY_BASE_URL = "cloudcode-pa://antigravity";

export const HERMES_ANTIGRAVITY_MODELS = [
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-high",
  "gemini-3.5-flash-low",
  "gemini-3.1-pro-low",
  "gemini-3.1-pro-high",
  "claude-sonnet-4-6-thinking",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
] as const;

export const HERMES_ANTIGRAVITY_PLUGIN_INIT = `"""Antigravity Code Assist provider profile for Hermes.

This is a user-level model-provider plugin. It lives under
\`\`$HERMES_HOME/plugins/model-providers\`\` so it survives \`\`hermes update\`\`.

The runtime credentials are stored in \`\`credential_pool.antigravity\`\` and point
at the OpenCode Antigravity account pool. The marker base URL makes Hermes use
the existing Gemini Cloud Code adapter path instead of a generic REST client.
"""

from providers import register_provider
from providers.base import ProviderProfile


def _register_auth_provider() -> None:
    """Expose Antigravity to Hermes' auth/runtime provider registry.

    ProviderProfile discovery alone is enough for the picker catalog, but the
    runtime still validates requested providers against
    \`\`hermes_cli.auth.PROVIDER_REGISTRY\`\`. Registering here keeps the user-level
    plugin self-contained and update-resistant.
    """
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY, ProviderConfig

        PROVIDER_REGISTRY.setdefault(
            "antigravity",
            ProviderConfig(
                id="antigravity",
                name="Antigravity",
                auth_type="api_key",
                inference_base_url="cloudcode-pa://antigravity",
                api_key_env_vars=(),
            ),
        )
    except Exception:
        pass


class AntigravityProfile(ProviderProfile):
    """Antigravity OAuth pool, routed through the Cloud Code Assist adapter."""

    def fetch_models(
        self,
        *,
        api_key: str | None = None,
        timeout: float = 8.0,
    ) -> list[str] | None:
        """Antigravity does not expose a normal /models endpoint here."""
        return list(self.fallback_models)


antigravity = AntigravityProfile(
    name="antigravity",
    aliases=("agy", "antigravity-cli", "google-antigravity"),
    api_mode="chat_completions",
    display_name="Antigravity",
    description="Antigravity Code Assist OAuth account pool",
    # Marker env var only. Hermes' auth registry auto-adds user provider
    # plugins only when at least one env var is declared. The actual runtime
    # credential comes from credential_pool.antigravity.
    env_vars=("ANTIGRAVITY_ACCOUNT_POOL",),
    base_url="cloudcode-pa://antigravity",
    # Keep this as api_key so Hermes' current plugin auto-discovery exposes it
    # in CANONICAL_PROVIDERS. Credentials still come from credential_pool.
    auth_type="api_key",
    supports_health_check=False,
    fallback_models=(
        "gemini-3.5-flash-medium",
        "gemini-3.5-flash-high",
        "gemini-3.5-flash-low",
        "gemini-3.1-pro-low",
        "gemini-3.1-pro-high",
        "claude-sonnet-4-6-thinking",
        "claude-opus-4-6-thinking",
        "gpt-oss-120b-medium",
    ),
    default_aux_model="gemini-3.5-flash-low",
)

register_provider(antigravity)
_register_auth_provider()
`;

export const HERMES_ANTIGRAVITY_PLUGIN_YAML = `name: antigravity-provider-profile
kind: model-provider
version: 1.0.0
description: Antigravity Code Assist OAuth provider backed by the OpenCode account pool.
author: Augusto Caruso
`;

export interface HermesAntigravityProviderPaths {
  hermesHome: string;
  hermesAgentDir: string;
  pluginDir: string;
  pluginInitPath: string;
  pluginYamlPath: string;
  authPath: string;
  opencodeAccountsPath: string;
}

export interface EnsureHermesAntigravityProviderReport {
  status: "current" | "installed" | "preview" | "skipped";
  reason: string;
  writes: string[];
  backups: BackupRecord[];
  paths: HermesAntigravityProviderPaths;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return isObject(parsed) ? parsed : {};
}

export function hermesAntigravityProviderPaths(homeDir: string): HermesAntigravityProviderPaths {
  const hermesHome = path.join(homeDir, ".hermes");
  const hermesAgentDir = path.join(hermesHome, "hermes-agent");
  const pluginDir = path.join(homeDir, ANTIGRAVITY_PROVIDER_DIR);
  return {
    hermesHome,
    hermesAgentDir,
    pluginDir,
    pluginInitPath: path.join(pluginDir, "__init__.py"),
    pluginYamlPath: path.join(pluginDir, "plugin.yaml"),
    authPath: path.join(hermesHome, "auth.json"),
    opencodeAccountsPath: path.join(homeDir, ".config", "opencode", "antigravity-accounts.json"),
  };
}

export function hermesInstalled(homeDir: string): boolean {
  const paths = hermesAntigravityProviderPaths(homeDir);
  return fs.existsSync(paths.hermesAgentDir) && fs.statSync(paths.hermesAgentDir).isDirectory();
}

function textMatches(filePath: string, expected: string): boolean {
  try {
    return fs.readFileSync(filePath, "utf8") === expected;
  } catch {
    return false;
  }
}

function authPoolHasAntigravityEntry(authPath: string, opencodeAccountsPath: string): boolean {
  const auth = readJsonObject(authPath);
  const pool = auth.credential_pool;
  if (!isObject(pool)) return false;
  const entries = pool.antigravity;
  if (!Array.isArray(entries)) return false;
  return entries.some(
    (entry) =>
      isObject(entry) &&
      entry.auth_file === opencodeAccountsPath &&
      entry.base_url === ANTIGRAVITY_BASE_URL,
  );
}

export function hermesAntigravityProviderCurrent(homeDir: string): boolean {
  const paths = hermesAntigravityProviderPaths(homeDir);
  return (
    textMatches(paths.pluginInitPath, HERMES_ANTIGRAVITY_PLUGIN_INIT) &&
    textMatches(paths.pluginYamlPath, HERMES_ANTIGRAVITY_PLUGIN_YAML) &&
    authPoolHasAntigravityEntry(paths.authPath, paths.opencodeAccountsPath)
  );
}

export function hermesAntigravityProviderNeedsInstall(homeDir: string): boolean {
  return hermesInstalled(homeDir) && !hermesAntigravityProviderCurrent(homeDir);
}

function backupIfNeeded(
  filePath: string,
  backupSession: BackupSession | undefined,
  backedUp: Set<string>,
): void {
  if (!backupSession || backedUp.has(filePath) || !fs.existsSync(filePath)) return;
  backupSession.backupExisting(filePath);
  backedUp.add(filePath);
}

function writeTextIfChanged(
  filePath: string,
  content: string,
  options: {
    dryRun: boolean;
    backupSession?: BackupSession;
    backedUp: Set<string>;
    writes: string[];
  },
): void {
  if (textMatches(filePath, content)) return;
  options.writes.push(filePath);
  if (options.dryRun) return;
  backupIfNeeded(filePath, options.backupSession, options.backedUp);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function ensureAuthPoolEntry(
  authPath: string,
  opencodeAccountsPath: string,
  options: {
    dryRun: boolean;
    backupSession?: BackupSession;
    backedUp: Set<string>;
    writes: string[];
  },
): void {
  if (authPoolHasAntigravityEntry(authPath, opencodeAccountsPath)) return;

  const auth = readJsonObject(authPath);
  auth.version ??= 1;
  if (!isObject(auth.credential_pool)) auth.credential_pool = {};
  const pool = auth.credential_pool as Record<string, unknown>;
  if (!Array.isArray(pool.antigravity)) pool.antigravity = [];
  const entries = pool.antigravity as unknown[];
  entries.push({
    id: "antigravity-oauth-2",
    label: "antigravity-oauth-2",
    auth_type: "oauth",
    priority: 0,
    source: "manual:opencode_antigravity",
    access_token: "opencode-antigravity-account-pool",
    base_url: ANTIGRAVITY_BASE_URL,
    auth_file: opencodeAccountsPath,
  });

  options.writes.push(authPath);
  if (options.dryRun) return;
  backupIfNeeded(authPath, options.backupSession, options.backedUp);
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
}

export function ensureHermesAntigravityProvider(options: {
  homeDir: string;
  dryRun?: boolean;
  backupSession?: BackupSession;
}): EnsureHermesAntigravityProviderReport {
  const paths = hermesAntigravityProviderPaths(options.homeDir);
  const dryRun = options.dryRun === true;
  const writes: string[] = [];
  const backedUp = new Set<string>();
  const backupStart = options.backupSession?.backups.length ?? 0;

  if (!hermesInstalled(options.homeDir)) {
    return {
      status: "skipped",
      reason: "Hermes is not installed in this home directory.",
      writes,
      backups: [],
      paths,
    };
  }

  writeTextIfChanged(paths.pluginInitPath, HERMES_ANTIGRAVITY_PLUGIN_INIT, {
    dryRun,
    backupSession: options.backupSession,
    backedUp,
    writes,
  });
  writeTextIfChanged(paths.pluginYamlPath, HERMES_ANTIGRAVITY_PLUGIN_YAML, {
    dryRun,
    backupSession: options.backupSession,
    backedUp,
    writes,
  });
  ensureAuthPoolEntry(paths.authPath, paths.opencodeAccountsPath, {
    dryRun,
    backupSession: options.backupSession,
    backedUp,
    writes,
  });

  if (writes.length === 0) {
    return {
      status: "current",
      reason: "Hermes Antigravity provider is already installed.",
      writes,
      backups: options.backupSession?.backups.slice(backupStart) ?? [],
      paths,
    };
  }

  return {
    status: dryRun ? "preview" : "installed",
    reason: dryRun
      ? "Would install Hermes Antigravity provider."
      : "Hermes Antigravity provider installed.",
    writes,
    backups: options.backupSession?.backups.slice(backupStart) ?? [],
    paths,
  };
}
