import fs from "node:fs";
import path from "node:path";
import type { BackupRecord, BackupSession } from "./backup-policy.js";

export const HERMES_ANTIGRAVITY_PROVIDER_PATCH_ID = "hermes-antigravity-provider-profile";

const ANTIGRAVITY_PROVIDER_DIR = path.join(".hermes", "plugins", "model-providers", "antigravity");
const ANTIGRAVITY_BASE_URL = "cloudcode-pa://antigravity";
const ANTIGRAVITY_ACCOUNT_POOL_ENV = "ANTIGRAVITY_ACCOUNT_POOL=opencode-antigravity-account-pool";

export const HERMES_ANTIGRAVITY_MODELS = [
  "gemini-3.5-flash-low",
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-high",
  "gemini-3.1-pro-low",
  "claude-sonnet-4-6-thinking",
  "claude-opus-4-6-thinking",
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
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any


ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc"
ANTIGRAVITY_ENDPOINTS = (
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://autopush-cloudcode-pa.sandbox.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
)
ANTIGRAVITY_LOAD_ENDPOINTS = (
    "https://cloudcode-pa.googleapis.com",
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://autopush-cloudcode-pa.sandbox.googleapis.com",
)


def _opencode_package_cache_roots() -> list[Path]:
    home = Path.home()
    roots: list[Path] = []
    for value in (
        os.environ.get("OPENCODE_PACKAGE_CACHE"),
        os.environ.get("OPENCODE_PACKAGES_DIR"),
    ):
        if value:
            roots.append(Path(value).expanduser())
    roots.extend([
        home / ".cache" / "opencode" / "packages",
        home / ".local" / "share" / "opencode" / "packages",
    ])
    return roots


def _read_antigravity_oauth_client_from_package() -> tuple[str, str] | None:
    candidates: list[Path] = []
    for root in _opencode_package_cache_roots():
        if not root.exists():
            continue
        candidates.extend(root.glob("opencode-antigravity-auth@*/node_modules/opencode-antigravity-auth/dist/src/constants.js"))
        candidates.extend(root.glob("@*/opencode-antigravity-auth@*/node_modules/opencode-antigravity-auth/dist/src/constants.js"))

    for constants_path in candidates:
        try:
            text = constants_path.read_text()
        except Exception:
            continue
        client_id_match = re.search(r'ANTIGRAVITY_CLIENT_ID\\s*=\\s*["\\']([^"\\']+)["\\']', text)
        client_secret_match = re.search(r'ANTIGRAVITY_CLIENT_SECRET\\s*=\\s*["\\']([^"\\']+)["\\']', text)
        if client_id_match and client_secret_match:
            return client_id_match.group(1), client_secret_match.group(1)
    return None


def _antigravity_oauth_client() -> tuple[str, str]:
    env_id = str(os.environ.get("AGENTX_ANTIGRAVITY_CLIENT_ID") or os.environ.get("ANTIGRAVITY_CLIENT_ID") or "").strip()
    env_secret = str(os.environ.get("AGENTX_ANTIGRAVITY_CLIENT_SECRET") or os.environ.get("ANTIGRAVITY_CLIENT_SECRET") or "").strip()
    if env_id and env_secret:
        return env_id, env_secret

    discovered = _read_antigravity_oauth_client_from_package()
    if discovered:
        return discovered

    raise RuntimeError(
        "Antigravity OAuth client constants were not found. Install opencode-antigravity-auth or set "
        "AGENTX_ANTIGRAVITY_CLIENT_ID and AGENTX_ANTIGRAVITY_CLIENT_SECRET."
    )


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


def _auth_json_path() -> Path:
    try:
        from hermes_constants import get_hermes_home

        return get_hermes_home() / "auth.json"
    except Exception:
        return Path.home() / ".hermes" / "auth.json"


def _accounts_path() -> Path:
    try:
        auth = json.loads(_auth_json_path().read_text())
        entries = auth.get("credential_pool", {}).get("antigravity", [])
        if isinstance(entries, list):
            for entry in entries:
                if isinstance(entry, dict) and entry.get("auth_file"):
                    return Path(str(entry["auth_file"])).expanduser()
    except Exception:
        pass
    return Path.home() / ".config" / "opencode" / "antigravity-accounts.json"


def _read_accounts() -> dict[str, Any]:
    path = _accounts_path()
    try:
        data = json.loads(path.read_text())
    except Exception:
        data = {}
    return data if isinstance(data, dict) else {}


def _write_accounts(data: dict[str, Any]) -> None:
    path = _accounts_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}.{uuid.uuid4().hex}")
    tmp.write_text(json.dumps(data, indent=2) + "\\n")
    tmp.replace(path)
    try:
        path.chmod(0o600)
    except Exception:
        pass


def _model_family(model: str) -> str:
    lowered = (model or "").lower()
    if "claude" in lowered or "sonnet" in lowered or "opus" in lowered:
        return "claude"
    return "gemini"


def _is_claude_model(model: str) -> bool:
    return _model_family(model) == "claude"


def _merge_thinking_config(existing: Any, updates: dict[str, Any]) -> dict[str, Any]:
    """Merge model-level thinking defaults without discarding Hermes overrides."""
    merged = dict(existing) if isinstance(existing, dict) else {}
    for key, value in updates.items():
        if value is not None:
            merged[key] = value
    return merged


def _resolve_antigravity_runtime_model(model: str, thinking_config: Any = None) -> tuple[str, Any]:
    """Translate Hermes-facing model aliases into Code Assist model ids.

    Antigravity's UI exposes names such as Gemini 3.5 Flash Low/Medium/High,
    but Code Assist currently accepts the runtime model id \`\`gemini-3-flash\`\`
    with a separate \`\`thinkingLevel\`\`. Keeping the alias at the Hermes layer
    preserves user-facing model names while sending the endpoint the contract it
    actually validates.
    """
    requested = str(model or "gemini-3.5-flash-low").strip() or "gemini-3.5-flash-low"
    lowered = requested.lower()

    flash_match = re.fullmatch(r"gemini-3(?:\\.5)?-flash(?:-(minimal|low|medium|high))?", lowered)
    if flash_match:
        level = flash_match.group(1) or "low"
        return "gemini-3-flash", _merge_thinking_config(thinking_config, {"thinkingLevel": level})

    pro_match = re.fullmatch(r"gemini-3\\.1-pro-(low|high)", lowered)
    if pro_match and pro_match.group(1) == "low":
        return requested, _merge_thinking_config(thinking_config, {"thinkingLevel": "low"})

    if lowered == "claude-sonnet-4-6-thinking":
        return "claude-sonnet-4-6", thinking_config

    return requested, thinking_config


def _select_account(data: dict[str, Any], model: str) -> dict[str, Any]:
    accounts = data.get("accounts")
    if not isinstance(accounts, list) or not accounts:
        raise RuntimeError(f"No Antigravity accounts found at {_accounts_path()}")
    enabled = [
        (index, account)
        for index, account in enumerate(accounts)
        if isinstance(account, dict) and account.get("enabled", True) is not False
    ]
    if not enabled:
        raise RuntimeError(f"No enabled Antigravity accounts found at {_accounts_path()}")

    family = _model_family(model)
    active_by_family = data.get("activeIndexByFamily")
    candidates: list[int] = []
    if isinstance(active_by_family, dict) and isinstance(active_by_family.get(family), int):
        candidates.append(active_by_family[family])
    if isinstance(data.get("activeIndex"), int):
        candidates.append(data["activeIndex"])
    candidates.append(enabled[0][0])

    enabled_by_index = {index: account for index, account in enabled}
    for index in candidates:
        if index in enabled_by_index:
            return enabled_by_index[index]
    return enabled[0][1]


def _parse_refresh_parts(refresh: str) -> tuple[str, str, str]:
    parts = (refresh or "").split("|")
    refresh_token = parts[0] if len(parts) > 0 else ""
    project_id = parts[1] if len(parts) > 1 else ""
    managed_project_id = parts[2] if len(parts) > 2 else ""
    return refresh_token, project_id, managed_project_id


def _refresh_access_token(account: dict[str, Any]) -> str:
    refresh_token, _, _ = _parse_refresh_parts(str(account.get("refreshToken") or ""))
    if not refresh_token:
        raise RuntimeError("Selected Antigravity account has no refresh token.")
    client_id, client_secret = _antigravity_oauth_client()

    body = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }).encode("utf-8")
    request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Antigravity token refresh failed HTTP {exc.code}: {detail[:300]}") from exc

    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise RuntimeError("Antigravity token refresh returned no access_token.")
    next_refresh = str(payload.get("refresh_token") or "").strip()
    if next_refresh:
        _, project_id, managed_project_id = _parse_refresh_parts(str(account.get("refreshToken") or ""))
        packed = f"{next_refresh}|{project_id}"
        if managed_project_id:
            packed = f"{packed}|{managed_project_id}"
        account["refreshToken"] = packed
    account["lastUsed"] = int(time.time() * 1000)
    return access_token


def _platform_for_metadata() -> str:
    if os.name == "nt":
        return "WINDOWS"
    if sys_platform := os.environ.get("AGENTX_ANTIGRAVITY_PLATFORM"):
        return sys_platform
    return "MACOS"


def _metadata(project_id: str = "") -> dict[str, Any]:
    metadata = {
        "ideType": "ANTIGRAVITY",
        "platform": _platform_for_metadata(),
        "pluginType": "GEMINI",
    }
    if project_id:
        metadata["duetProject"] = project_id
    return metadata


def _resolve_project_id(access_token: str, account: dict[str, Any]) -> str:
    refresh_token, project_id, managed_project_id = _parse_refresh_parts(str(account.get("refreshToken") or ""))
    if managed_project_id:
        return managed_project_id
    if project_id:
        return project_id
    explicit = str(account.get("projectId") or "").strip()
    if explicit:
        return explicit

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
        "User-Agent": "google-api-nodejs-client/9.15.1",
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
        "Client-Metadata": json.dumps(_metadata(ANTIGRAVITY_DEFAULT_PROJECT_ID), separators=(",", ":")),
    }
    body = json.dumps({"metadata": _metadata(ANTIGRAVITY_DEFAULT_PROJECT_ID)}).encode("utf-8")
    for endpoint in ANTIGRAVITY_LOAD_ENDPOINTS:
        request = urllib.request.Request(
            f"{endpoint}/v1internal:loadCodeAssist",
            data=body,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            continue
        project = payload.get("cloudaicompanionProject")
        if isinstance(project, str) and project:
            account["refreshToken"] = f"{refresh_token}|{project}|{project}"
            return project
        if isinstance(project, dict) and isinstance(project.get("id"), str) and project["id"]:
            account["refreshToken"] = f"{refresh_token}|{project['id']}|{project['id']}"
            return project["id"]
    return ANTIGRAVITY_DEFAULT_PROJECT_ID


def _antigravity_headers(access_token: str, account: dict[str, Any], model: str = "") -> dict[str, str]:
    fingerprint = account.get("fingerprint") if isinstance(account.get("fingerprint"), dict) else {}
    user_agent = str(fingerprint.get("userAgent") or "").strip() or "antigravity/1.18.3 linux/x64"
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {access_token}",
        "User-Agent": user_agent,
        "x-activity-request-id": str(uuid.uuid4()),
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
        "Client-Metadata": json.dumps(_metadata(), separators=(",", ":")),
    }
    if _is_claude_model(model) and "thinking" in (model or "").lower():
        headers["anthropic-beta"] = "interleaved-thinking-2025-05-14"
    return headers


def _ensure_claude_tool_config(inner_request: dict[str, Any]) -> None:
    tool_config = inner_request.get("toolConfig")
    if not isinstance(tool_config, dict):
        tool_config = {}
        inner_request["toolConfig"] = tool_config
    function_config = tool_config.get("functionCallingConfig")
    if not isinstance(function_config, dict):
        function_config = {}
        tool_config["functionCallingConfig"] = function_config
    function_config["mode"] = "VALIDATED"


def _antigravity_tool_call_id(name: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", name or "tool").strip("_") or "tool"
    return f"{safe}-{uuid.uuid4()}"


def _add_claude_function_call_ids(inner_request: dict[str, Any]) -> None:
    contents = inner_request.get("contents")
    if not isinstance(contents, list):
        return
    id_queues: dict[str, list[str]] = {}
    for content in contents:
        if not isinstance(content, dict):
            continue
        parts = content.get("parts")
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            function_call = part.get("functionCall")
            if isinstance(function_call, dict) and isinstance(function_call.get("name"), str):
                name = str(function_call["name"])
                call_id = str(function_call.get("id") or "").strip()
                if not call_id:
                    call_id = _antigravity_tool_call_id(name)
                    function_call["id"] = call_id
                id_queues.setdefault(name, []).append(call_id)

            function_response = part.get("functionResponse")
            if isinstance(function_response, dict) and isinstance(function_response.get("name"), str):
                name = str(function_response["name"])
                response_id = str(function_response.get("id") or "").strip()
                if response_id:
                    continue
                queue = id_queues.get(name)
                if queue:
                    function_response["id"] = queue.pop(0)


def _prepare_antigravity_request(*, project_id: str, model: str, inner_request: dict[str, Any]) -> dict[str, Any]:
    request_id = str(uuid.uuid4())
    inner_request["sessionId"] = inner_request.get("sessionId") or request_id
    wrapped: dict[str, Any] = {
        "project": project_id,
        "model": model,
        "user_prompt_id": str(uuid.uuid4()),
        "request": inner_request,
        "userAgent": "antigravity",
        "requestId": request_id,
    }
    if _is_claude_model(model):
        _ensure_claude_tool_config(inner_request)
        _add_claude_function_call_ids(inner_request)
        wrapped["requestType"] = "agent"
    return wrapped


def _patch_antigravity_cloudcode_client() -> None:
    try:
        import agent.gemini_cloudcode_adapter as adapter
        import httpx
    except Exception:
        return
    if getattr(adapter.GeminiCloudCodeClient, "__agentx_antigravity_patched__", False):
        return

    BaseClient = adapter.GeminiCloudCodeClient

    class AntigravityAwareCloudCodeClient(BaseClient):
        __agentx_antigravity_patched__ = True

        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._agentx_is_antigravity = str(self.base_url or "").startswith("cloudcode-pa://antigravity")

        def _antigravity_context(self, model: str):
            data = _read_accounts()
            account = _select_account(data, model)
            access_token = _refresh_access_token(account)
            project_id = _resolve_project_id(access_token, account)
            _write_accounts(data)
            return access_token, project_id, account

        def _create_chat_completion(self, **kwargs):
            if not self._agentx_is_antigravity:
                return super()._create_chat_completion(**kwargs)

            requested_model = str(kwargs.get("model") or "gemini-3.5-flash-low")
            messages = kwargs.get("messages") or []
            extra_body = kwargs.get("extra_body")
            thinking_config = None
            if isinstance(extra_body, dict):
                thinking_config = extra_body.get("thinking_config") or extra_body.get("thinkingConfig")
            runtime_model, thinking_config = _resolve_antigravity_runtime_model(requested_model, thinking_config)

            access_token, project_id, account = self._antigravity_context(requested_model)
            inner = adapter.build_gemini_request(
                messages=messages,
                tools=kwargs.get("tools"),
                tool_choice=kwargs.get("tool_choice"),
                temperature=kwargs.get("temperature"),
                max_tokens=kwargs.get("max_tokens"),
                top_p=kwargs.get("top_p"),
                stop=kwargs.get("stop"),
                thinking_config=thinking_config,
            )
            wrapped = _prepare_antigravity_request(
                project_id=project_id,
                model=runtime_model,
                inner_request=inner,
            )
            headers = _antigravity_headers(access_token, account, runtime_model)
            if kwargs.get("stream"):
                return self._agentx_stream_completion(model=requested_model, wrapped=wrapped, headers=headers)

            last_response = None
            for endpoint in ANTIGRAVITY_ENDPOINTS:
                response = self._http.post(
                    f"{endpoint}/v1internal:generateContent",
                    json=wrapped,
                    headers=headers,
                )
                last_response = response
                if response.status_code == 200:
                    try:
                        payload = response.json()
                    except ValueError as exc:
                        raise adapter.CodeAssistError(
                            f"Invalid JSON from Antigravity Code Assist: {exc}",
                            code="antigravity_code_assist_invalid_json",
                        ) from exc
                    return adapter._translate_gemini_response(payload, model=requested_model)
                if response.status_code in {403, 404} or response.status_code >= 500:
                    continue
                break
            raise adapter._gemini_http_error(last_response)

        def _agentx_stream_completion(self, *, model: str, wrapped: dict[str, Any], headers: dict[str, str]):
            stream_headers = dict(headers)
            stream_headers["Accept"] = "text/event-stream"

            def _generator():
                last_response = None
                for endpoint in ANTIGRAVITY_ENDPOINTS:
                    try:
                        with self._http.stream(
                            "POST",
                            f"{endpoint}/v1internal:streamGenerateContent?alt=sse",
                            json=wrapped,
                            headers=stream_headers,
                        ) as response:
                            last_response = response
                            if response.status_code != 200:
                                response.read()
                                if response.status_code in {403, 404} or response.status_code >= 500:
                                    continue
                                raise adapter._gemini_http_error(response)
                            tool_call_counter = [0]
                            for event in adapter._iter_sse_events(response):
                                for chunk in adapter._translate_stream_event(event, model, tool_call_counter):
                                    yield chunk
                            return
                    except httpx.HTTPError as exc:
                        raise adapter.CodeAssistError(
                            f"Antigravity streaming request failed: {exc}",
                            code="antigravity_code_assist_stream_error",
                        ) from exc
                if last_response is not None:
                    raise adapter._gemini_http_error(last_response)

            return _generator()

    adapter.GeminiCloudCodeClient = AntigravityAwareCloudCodeClient


def _provider_matches(name: str | None) -> bool:
    requested = (name or "").strip().lower()
    aliases = {antigravity.name, *antigravity.aliases}
    return requested in aliases


def _antigravity_provider_def():
    try:
        from hermes_cli.providers import ProviderDef

        return ProviderDef(
            id=antigravity.name,
            name=antigravity.display_name or "Antigravity",
            transport="openai_chat",
            api_key_env_vars=tuple(antigravity.env_vars),
            base_url=antigravity.base_url,
            is_aggregator=False,
            auth_type=antigravity.auth_type,
            source="provider-plugin",
        )
    except Exception:
        return None


def _patch_provider_resolver() -> None:
    """Teach Hermes' model switcher to accept user provider profiles.

    Hermes' picker and model catalog already discover ProviderProfile plugins,
    but hermes_cli.providers.resolve_provider_full() currently checks only
    built-ins, config.yaml providers, custom_providers, and models.dev. That
    makes /model and --provider reject Antigravity even after the plugin is
    installed. Keep the patch narrow and delegate to the original resolver
    first, then expose this ProviderProfile as a normal ProviderDef.
    """
    try:
        from hermes_cli import providers as _hermes_providers
    except Exception:
        return

    current = _hermes_providers.resolve_provider_full
    original = getattr(current, "__agentx_antigravity_original__", current)

    def resolve_provider_full(name, user_providers=None, custom_providers=None):
        resolved = original(name, user_providers, custom_providers)
        if resolved is not None:
            return resolved
        if _provider_matches(name):
            return _antigravity_provider_def()
        return None

    resolve_provider_full.__agentx_antigravity_original__ = original
    resolve_provider_full.__agentx_antigravity_patched__ = True
    _hermes_providers.resolve_provider_full = resolve_provider_full

    try:
        import sys

        model_switch = sys.modules.get("hermes_cli.model_switch")
        if model_switch is not None:
            model_switch.resolve_provider_full = resolve_provider_full
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
        "gemini-3.5-flash-low",
        "gemini-3.5-flash-medium",
        "gemini-3.5-flash-high",
        "gemini-3.1-pro-low",
        "claude-sonnet-4-6-thinking",
        "claude-opus-4-6-thinking",
    ),
    default_aux_model="gemini-3.5-flash-low",
)

register_provider(antigravity)
_register_auth_provider()
_patch_provider_resolver()
_patch_antigravity_cloudcode_client()
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
  hermesAgentEnvPath: string;
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
    hermesAgentEnvPath: path.join(hermesAgentDir, ".env"),
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
  return entries.some((entry) =>
    isObject(entry)
    && entry.auth_file === opencodeAccountsPath
    && entry.base_url === ANTIGRAVITY_BASE_URL
  );
}

function envHasAntigravityMarker(envPath: string): boolean {
  try {
    return fs.readFileSync(envPath, "utf8").split(/\r?\n/).includes(ANTIGRAVITY_ACCOUNT_POOL_ENV);
  } catch {
    return false;
  }
}

export function hermesAntigravityProviderCurrent(homeDir: string): boolean {
  const paths = hermesAntigravityProviderPaths(homeDir);
  return textMatches(paths.pluginInitPath, HERMES_ANTIGRAVITY_PLUGIN_INIT)
    && textMatches(paths.pluginYamlPath, HERMES_ANTIGRAVITY_PLUGIN_YAML)
    && authPoolHasAntigravityEntry(paths.authPath, paths.opencodeAccountsPath)
    && envHasAntigravityMarker(paths.hermesAgentEnvPath);
}

export function hermesAntigravityProviderNeedsInstall(homeDir: string): boolean {
  return hermesInstalled(homeDir) && !hermesAntigravityProviderCurrent(homeDir);
}

function backupIfNeeded(filePath: string, backupSession: BackupSession | undefined, backedUp: Set<string>): void {
  if (!backupSession || backedUp.has(filePath) || !fs.existsSync(filePath)) return;
  backupSession.backupExisting(filePath);
  backedUp.add(filePath);
}

function writeTextIfChanged(
  filePath: string,
  content: string,
  options: { dryRun: boolean; backupSession?: BackupSession; backedUp: Set<string>; writes: string[] },
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
  options: { dryRun: boolean; backupSession?: BackupSession; backedUp: Set<string>; writes: string[] },
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

function ensureHermesEnvMarker(
  envPath: string,
  options: { dryRun: boolean; backupSession?: BackupSession; backedUp: Set<string>; writes: string[] },
): void {
  if (envHasAntigravityMarker(envPath)) return;

  let current = "";
  try {
    current = fs.readFileSync(envPath, "utf8");
  } catch {
    current = "";
  }
  const lines = current.split(/\r?\n/).filter((line) => !line.startsWith("ANTIGRAVITY_ACCOUNT_POOL="));
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  const next = `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}${ANTIGRAVITY_ACCOUNT_POOL_ENV}\n`;

  options.writes.push(envPath);
  if (options.dryRun) return;
  backupIfNeeded(envPath, options.backupSession, options.backedUp);
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, next, "utf8");
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
  ensureHermesEnvMarker(paths.hermesAgentEnvPath, {
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
