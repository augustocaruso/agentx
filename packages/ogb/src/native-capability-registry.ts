export type NativeCapabilityTarget = "opencode" | "gemini-cli" | "antigravity-cli" | "antigravity-legacy";
export type NativeCapabilityEntityId =
  | "anki"
  | "context7-mcp"
  | "google-workspace-mcp"
  | "honcho"
  | "notion-mcp"
  | "playwright-mcp"
  | "superpowers";
export type NativeCapabilityStatus = "available" | "not_available" | "experimental" | "blocked";
export type NativeSurface = "agents" | "commands" | "config" | "hooks" | "mcp" | "prompts" | "skills";

export interface OpenCodePluginNativeInstall {
  kind: "opencode-plugin";
  plugin: string;
  smokeCommand?: string[];
  smokeOutputHints?: string[];
}

export interface OpenCodeMcpNativeInstall {
  kind: "opencode-mcp";
  mcpName: string;
  command?: string;
  args?: string[];
  packageNames: string[];
}

export type NativeInstallSpec = OpenCodePluginNativeInstall | OpenCodeMcpNativeInstall;

export interface NativeCapabilityEntry {
  entityId: NativeCapabilityEntityId;
  displayName: string;
  target: NativeCapabilityTarget;
  nativeStatus: NativeCapabilityStatus;
  nativeInstall?: NativeInstallSpec;
  portableSurfaces: NativeSurface[];
  surfacesNeedingReview: NativeSurface[];
  managedPortPrefixes: string[];
  extensionAliases: string[];
  skillAliases: string[];
  mcpAliases: string[];
  pluginAliases: string[];
  docs: string[];
  notes: string[];
}

export const NATIVE_CAPABILITY_REGISTRY: readonly NativeCapabilityEntry[] = [
  {
    entityId: "superpowers",
    displayName: "Superpowers",
    target: "opencode",
    nativeStatus: "available",
    nativeInstall: {
      kind: "opencode-plugin",
      plugin: "superpowers@git+https://github.com/obra/superpowers.git",
      smokeCommand: ["opencode", "debug", "info"],
      smokeOutputHints: ["superpowers"],
    },
    portableSurfaces: ["skills"],
    surfacesNeedingReview: [],
    managedPortPrefixes: [".opencode/skills/", ".config/opencode/skills/"],
    extensionAliases: ["superpowers", "gemini-superpowers", "superpower"],
    skillAliases: ["superpowers", "superpower"],
    mcpAliases: [],
    pluginAliases: ["superpowers"],
    docs: ["https://github.com/obra/superpowers/blob/main/docs/README.opencode.md"],
    notes: ["Prefer the native OpenCode plugin when runtime smoke confirms the plugin is loaded."],
  },
  {
    entityId: "honcho",
    displayName: "Honcho",
    target: "opencode",
    nativeStatus: "available",
    nativeInstall: {
      kind: "opencode-plugin",
      plugin: "@honcho-ai/opencode-honcho",
      smokeCommand: ["opencode", "debug", "info"],
      smokeOutputHints: ["honcho"],
    },
    portableSurfaces: ["mcp", "config", "prompts", "commands", "hooks"],
    surfacesNeedingReview: ["prompts", "commands", "hooks"],
    managedPortPrefixes: [".opencode/commands/honcho", ".opencode/plugins/honcho"],
    extensionAliases: ["honcho", "gemini-honcho"],
    skillAliases: ["honcho"],
    mcpAliases: ["honcho", "honcho-mcp"],
    pluginAliases: ["@honcho-ai/opencode-honcho"],
    docs: ["https://docs.honcho.dev/v3/guides/integrations/opencode"],
    notes: ["OpenCode is the richest known Honcho host; other targets need explicit adapter data."],
  },
  {
    entityId: "anki",
    displayName: "Anki MCP",
    target: "opencode",
    nativeStatus: "available",
    nativeInstall: {
      kind: "opencode-mcp",
      mcpName: "anki",
      command: "uvx",
      args: ["anki-mcp"],
      packageNames: ["anki-mcp"],
    },
    portableSurfaces: ["mcp", "config"],
    surfacesNeedingReview: [],
    managedPortPrefixes: [],
    extensionAliases: ["anki", "anki-mcp"],
    skillAliases: ["anki", "anki-mcp"],
    mcpAliases: ["anki", "anki-mcp"],
    pluginAliases: [],
    docs: [],
    notes: ["Treat Anki as a portable MCP capability; project the server config when no richer native package is known."],
  },
  {
    entityId: "playwright-mcp",
    displayName: "Playwright MCP",
    target: "opencode",
    nativeStatus: "available",
    nativeInstall: {
      kind: "opencode-mcp",
      mcpName: "playwright",
      command: "npx",
      args: ["-y", "@playwright/mcp"],
      packageNames: ["@playwright/mcp"],
    },
    portableSurfaces: ["mcp", "config"],
    surfacesNeedingReview: [],
    managedPortPrefixes: [],
    extensionAliases: ["playwright", "playwright-mcp"],
    skillAliases: ["playwright", "playwright-mcp"],
    mcpAliases: ["playwright", "playwright-mcp", "browsermcp", "browser-mcp"],
    pluginAliases: [],
    docs: [],
    notes: ["Treat Playwright as a portable MCP capability; do not infer browser automation plugins without an explicit registry entry."],
  },
  {
    entityId: "context7-mcp",
    displayName: "Context7 MCP",
    target: "opencode",
    nativeStatus: "available",
    nativeInstall: {
      kind: "opencode-mcp",
      mcpName: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      packageNames: ["@upstash/context7-mcp", "context7-mcp"],
    },
    portableSurfaces: ["mcp", "config"],
    surfacesNeedingReview: [],
    managedPortPrefixes: [],
    extensionAliases: ["context7", "context7-mcp"],
    skillAliases: ["context7", "context7-mcp"],
    mcpAliases: ["context7", "context7-mcp"],
    pluginAliases: [],
    docs: [],
    notes: ["Known MCP-shaped capability; preserve generated MCP config rather than inventing plugin ports."],
  },
  {
    entityId: "google-workspace-mcp",
    displayName: "Google Workspace MCP",
    target: "opencode",
    nativeStatus: "available",
    nativeInstall: {
      kind: "opencode-mcp",
      mcpName: "gws",
      command: "gws",
      args: ["mcp"],
      packageNames: ["@googleworkspace/cli"],
    },
    portableSurfaces: ["mcp", "config", "skills"],
    surfacesNeedingReview: ["skills"],
    managedPortPrefixes: [],
    extensionAliases: ["gws", "google-workspace", "google-workspace-cli", "google-workspace-mcp"],
    skillAliases: ["gws", "gws-drive", "gws-gmail", "gws-calendar", "google-workspace"],
    mcpAliases: ["gws", "google-workspace", "google-workspace-mcp"],
    pluginAliases: [],
    docs: ["https://github.com/googleworkspace/cli"],
    notes: ["Use the gws MCP surface for Google Workspace; skills can be replicated only through explicit adapters."],
  },
  {
    entityId: "notion-mcp",
    displayName: "Notion MCP",
    target: "opencode",
    nativeStatus: "available",
    nativeInstall: {
      kind: "opencode-mcp",
      mcpName: "notion",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      packageNames: ["@notionhq/notion-mcp-server"],
    },
    portableSurfaces: ["mcp", "config"],
    surfacesNeedingReview: [],
    managedPortPrefixes: [],
    extensionAliases: ["notion", "notion-mcp"],
    skillAliases: ["notion", "notion-mcp"],
    mcpAliases: ["notion", "notion-mcp"],
    pluginAliases: [],
    docs: [],
    notes: ["Known MCP-shaped capability; keep secrets in the OGB MCP env store when projecting config."],
  },
  {
    entityId: "honcho",
    displayName: "Honcho",
    target: "gemini-cli",
    nativeStatus: "not_available",
    portableSurfaces: ["mcp", "config", "prompts", "commands", "hooks"],
    surfacesNeedingReview: ["prompts", "commands", "hooks"],
    managedPortPrefixes: [".gemini/settings.json#mcpServers/honcho"],
    extensionAliases: ["honcho", "gemini-honcho"],
    skillAliases: ["honcho"],
    mcpAliases: ["honcho", "honcho-mcp"],
    pluginAliases: ["@honcho-ai/opencode-honcho"],
    docs: ["https://docs.honcho.dev/v3/guides/integrations/mcp"],
    notes: ["Use MCP metadata first; prompt, command, and hook projection require explicit adapter tests."],
  },
  {
    entityId: "honcho",
    displayName: "Honcho",
    target: "antigravity-cli",
    nativeStatus: "not_available",
    portableSurfaces: ["mcp", "config", "prompts", "commands", "hooks"],
    surfacesNeedingReview: ["prompts", "commands", "hooks"],
    managedPortPrefixes: [".gemini/antigravity-cli/mcp_config.json#mcpServers/honcho"],
    extensionAliases: ["honcho", "gemini-honcho"],
    skillAliases: ["honcho"],
    mcpAliases: ["honcho", "honcho-mcp"],
    pluginAliases: ["@honcho-ai/opencode-honcho"],
    docs: ["https://docs.honcho.dev/v3/guides/integrations/mcp"],
    notes: ["Keep compatibility data explicit until a native Antigravity CLI plugin exists and passes smoke."],
  },
  {
    entityId: "superpowers",
    displayName: "Superpowers",
    target: "antigravity-cli",
    nativeStatus: "not_available",
    portableSurfaces: ["skills"],
    surfacesNeedingReview: [],
    managedPortPrefixes: [".gemini/antigravity-cli/plugins/superpowers", ".gemini/antigravity-cli/skills/superpowers"],
    extensionAliases: ["superpowers", "gemini-superpowers", "superpower"],
    skillAliases: ["superpowers", "superpower"],
    mcpAliases: [],
    pluginAliases: ["superpowers"],
    docs: ["https://github.com/obra/superpowers/blob/main/docs/README.opencode.md"],
    notes: ["Antigravity CLI support stays as a managed port until a native plugin is known and validatable."],
  },
] as const;

function normalizedAlias(input: string): string {
  return input.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function matchesAlias(value: string, aliases: readonly string[]): boolean {
  const normalized = normalizedAlias(value);
  return aliases.some((alias) => {
    const item = normalizedAlias(alias);
    return normalized === item || normalized.endsWith(`-${item}`) || normalized.includes(item);
  });
}

export function pluginPackageName(plugin: string): string {
  const trimmed = plugin.trim();
  if (trimmed.startsWith("file:")) return trimmed;
  const gitMarker = trimmed.indexOf("@git+");
  if (gitMarker > 0 && !trimmed.startsWith("@")) return trimmed.slice(0, gitMarker);
  if (trimmed.startsWith("@")) {
    const atVersion = trimmed.indexOf("@", 1);
    return atVersion > 0 ? trimmed.slice(0, atVersion) : trimmed;
  }
  return trimmed.split("@")[0] || trimmed;
}

export function nativeCapabilityEntriesForTarget(target: NativeCapabilityTarget): NativeCapabilityEntry[] {
  return NATIVE_CAPABILITY_REGISTRY
    .filter((entry) => entry.target === target)
    .slice()
    .sort((a, b) => a.entityId.localeCompare(b.entityId));
}

export function capabilityEntry(entityId: NativeCapabilityEntityId, target: NativeCapabilityTarget): NativeCapabilityEntry | undefined {
  return NATIVE_CAPABILITY_REGISTRY.find((entry) => entry.entityId === entityId && entry.target === target);
}

export function entityIdFromGeminiExtensionName(name: string): NativeCapabilityEntityId | undefined {
  return nativeCapabilityEntriesForTarget("opencode").find((entry) => matchesAlias(name, entry.extensionAliases))?.entityId;
}

export function entityIdFromSkillName(name: string): NativeCapabilityEntityId | undefined {
  return nativeCapabilityEntriesForTarget("opencode").find((entry) => matchesAlias(name, entry.skillAliases))?.entityId;
}

export function entityIdFromOpenCodePlugin(plugin: string): NativeCapabilityEntityId | undefined {
  const packageName = pluginPackageName(plugin);
  return nativeCapabilityEntriesForTarget("opencode").find((entry) =>
    entry.pluginAliases.some((alias) => pluginPackageName(alias) === packageName)
  )?.entityId;
}

export function entityIdFromMcpServer(name: string, config: unknown): NativeCapabilityEntityId | undefined {
  const textParts = [name];
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const record = config as Record<string, unknown>;
    if (typeof record.command === "string") textParts.push(record.command);
    if (Array.isArray(record.command)) textParts.push(...record.command.filter((item): item is string => typeof item === "string"));
    if (Array.isArray(record.args)) textParts.push(...record.args.filter((item): item is string => typeof item === "string"));
  }
  const haystack = textParts.join(" ");
  return nativeCapabilityEntriesForTarget("opencode").find((entry) => {
    if (matchesAlias(name, entry.mcpAliases)) return true;
    const install = entry.nativeInstall;
    return install?.kind === "opencode-mcp" && install.packageNames.some((pkg) => haystack.toLowerCase().includes(pkg.toLowerCase()));
  })?.entityId;
}
